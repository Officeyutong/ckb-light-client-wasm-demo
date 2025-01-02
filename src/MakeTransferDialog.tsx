import { bytesConcat, bytesFrom, HasherCkb, hashTypeFromBytes, Hex, hexFrom, HexLike, numBeToBytes, numFrom, numToBytes, WitnessArgs } from "@ckb-ccc/core";
import { LightClient } from "light-client-js";
import { useState } from "react";
import { Button, Dimmer, Form, Input, Loader, Message, Modal } from "semantic-ui-react";
import { ccc } from "@ckb-ccc/core";
import { CellWithBlockNumAndTxIndex } from "light-client-js";
import { AddressFormat, addressPayloadFromString } from "@ckb-ccc/core/advancedBarrel";
import { secp256k1 } from "@noble/curves/secp256k1";

function signMessage(message: HexLike, privateKey: Hex): Hex {
    const signature = secp256k1.sign(
        bytesFrom(message),
        bytesFrom(privateKey),
    );
    const { r, s, recovery } = signature;

    return hexFrom(
        bytesConcat(
            numBeToBytes(r, 32),
            numBeToBytes(s, 32),
            numBeToBytes(recovery, 1),
        ),
    );
}

const MakeTransferDialog: React.FC<{
    client: LightClient,
    onClose: () => void;
    currentBalance: bigint;
    signerScript: ccc.Script;
    signerPrivateKey: Hex;
}> = ({ client, onClose, currentBalance, signerScript, signerPrivateKey }) => {
    const [loading, setLoading] = useState(false);
    const [txHash, setTxHash] = useState<null | Hex>(null);
    const [amount, setAmount] = useState<string>("200");
    const [receiver, setReceiver] = useState<string>("");
    const [transactionFee, setTransactionFee] = useState<string>("1000");
    const doTransfer = async () => {
        try {
            setLoading(true);
            // Receiver address object
            const { prefix, format, payload } = addressPayloadFromString(receiver);
            // debugger;
            if (format !== AddressFormat.Full) {
                throw new Error("Only support full format address");
            }
            if (prefix !== "ckt") {
                throw new Error("address must be prefixed by ckt");
            }
            const receiverAddress = ccc.Address.from({
                script: {
                    codeHash: payload.slice(0, 32),
                    hashType: hashTypeFromBytes(payload.slice(32, 33)),
                    args: payload.slice(33),
                },
                prefix,
            });
            // Collect cells
            const requiredBalance = BigInt(transactionFee) + BigInt((parseFloat(amount) * 1e8));
            let currentBalance = BigInt(0);
           
            const collectedCells: CellWithBlockNumAndTxIndex[] = [];
            let lastCursor: Hex | undefined;
            while (true) {
                const cells = await client.getCells({ script: signerScript, scriptSearchMode: "prefix", scriptType: "lock" }, "asc", 100, lastCursor);
                if (cells.cells.length === 0) break;
                lastCursor = cells.lastCursor as Hex;
                for (const item of cells.cells) {
                    if (currentBalance >= requiredBalance) break;
                    collectedCells.push(item);
                    currentBalance += numFrom(item.cellOutput.capacity);
                }
                if (currentBalance >= requiredBalance) break;
            }
            console.log("collected cells", collectedCells, "sum", currentBalance);
            const tx = ccc.Transaction.from({
                inputs: collectedCells.map(item => ({
                    previousOutput: item.outPoint
                })),
                outputs: [
                    {
                        capacity: BigInt((parseFloat(amount) * 1e8)),
                        lock: receiverAddress.script
                    }
                ],
                cellDeps: [
                    {
                        depType: "depGroup", outPoint: {
                            txHash: bytesFrom(
                                "0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37"
                            ), index: 0
                        }
                    }
                ]
            });
            const changeBalance = currentBalance - requiredBalance;
            if (changeBalance >= 61 * 1e8) {
                tx.addOutput({
                    capacity: changeBalance,
                    lock: signerScript
                })
            }
            for (let i = 0; i < tx.inputs.length; i++) {
                if (i === 0) {
                    tx.setWitnessArgsAt(i, WitnessArgs.from({ lock: hexFrom(new Uint8Array(65)) }));
                } else {
                    tx.setWitnessArgsAt(i, WitnessArgs.from({}));
                }
            }
            const hasher = new HasherCkb();
            hasher.update(bytesFrom(tx.hash()))
            const witnessLenBytes = numToBytes(numFrom(tx.getWitnessArgsAt(0)!.toBytes().length), 8);
            console.assert(witnessLenBytes.length === 8);
            hasher.update(witnessLenBytes);
            hasher.update(tx.getWitnessArgsAt(0)!.toBytes());
            for (let i = 1; i < tx.inputs.length; i++) {
                const current = tx.getWitnessArgsAt(i)!.toBytes();
                const witnessLenBytes = numToBytes(current.length, 8);
                console.assert(witnessLenBytes.length === 8);
                hasher.update(witnessLenBytes);
                hasher.update(current);
            }
            const sigHash = hasher.digest();
            const signature = signMessage(sigHash, signerPrivateKey);
            tx.setWitnessArgsAt(0, WitnessArgs.from({
                lock: signature
            }));
            console.log(tx);
            const txHash = await client.sendTransaction(tx);
            console.log(txHash);
            setTxHash(txHash);
        } catch (e) { alert(e); console.error(e); } finally {
            setLoading(false);
        }
    };
    return <Modal open size="small">
        <Modal.Header>
            Make a transfer
        </Modal.Header>
        <Modal.Content>
            {loading && <Dimmer active><Loader active></Loader> </Dimmer>}
            <Form>
                <Form.Field>
                    <label>Receiver's address</label>
                    <Input disabled={txHash !== null} value={receiver} onChange={(e, _) => setReceiver(e.target.value)}></Input>
                </Form.Field>
                <Form.Field>
                    <label>Amount (in CKB)</label>
                    <Input disabled={txHash !== null} value={amount} onChange={(e, _) => setAmount(e.target.value)}></Input>
                </Form.Field>
                <Form.Field>
                    <label>Transaction Fee (in shannon)</label>
                    <Input disabled={txHash !== null} value={transactionFee} onChange={(e, _) => setTransactionFee(e.target.value)}></Input>
                </Form.Field>
                <Form.Field>
                    <label>Available balance</label>
                    {Number(currentBalance) / 1e8} CKB
                </Form.Field>
                {txHash !== null && <Form.Field>
                    <label>Transaction hash</label>
                    <a href={`https://testnet.explorer.nervos.org/transaction/${txHash}`} target="_blank" rel="noreferrer">{txHash}</a>
                </Form.Field>}
            </Form>
            <Message info>
                <Message.Header>Note</Message.Header>
                <Message.Content>
                    Only secp256blake160 addresses are supported
                </Message.Content>
            </Message>
        </Modal.Content>
        <Modal.Actions>
            {txHash === null && <>
                <Button color="green" onClick={doTransfer} loading={loading}>Transfer</Button>
                <Button color="red" onClick={() => onClose()} loading={loading}>Cancel</Button>
            </>}
            {txHash !== null && <Button color="green" onClick={() => onClose()}>Close</Button>}
        </Modal.Actions>
    </Modal>
};


export default MakeTransferDialog;
