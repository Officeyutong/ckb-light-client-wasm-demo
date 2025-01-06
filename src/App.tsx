import { useCallback, useEffect, useRef, useState } from "react";
import networkConfig from "./config.toml";
import { LightClient, LightClientSetScriptsCommand, randomSecretKey, RemoteNode, Transaction } from "ckb-light-client-js";
import { Button, Container, Dimmer, Divider, Form, Header, List, Loader, Message, Segment, Table } from "semantic-ui-react";
import 'semantic-ui-css/semantic.min.css'
import { bytesFrom, ccc, CellOutputLike, ClientBlockHeader, hashCkb, Hex, hexFrom } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1";
import InputNewBlockDialog from "./InputNewBlockDialog";
import { ClientCollectableSearchKeyLike } from "@ckb-ccc/core/advancedBarrel";
import { GetTransactionsResponse, TxWithCells } from "ckb-light-client-js";
import { DateTime } from "luxon";
import MakeTransferDialog from "./MakeTransferDialog";
enum StateId {
    Loadingclient = 1,
    ClientLoaded = 2,
    AccountGenerated = 3
}

interface StateLoadingClient {
    id: StateId.Loadingclient;
}

interface StateClientLoaded extends Omit<StateLoadingClient, "id"> {
    id: StateId.ClientLoaded;
    client: LightClient;
}

interface StateAccountGenerated extends Omit<StateClientLoaded, "id"> {
    id: StateId.AccountGenerated;
    privateKey: Hex;
    publicKey: Hex;
    address: ccc.Address;
    script: ccc.Script;
}

const randomPrivateKey = () => {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return hexFrom(buf);
};

interface DisplayTransaction {
    txHash: Hex;
    balanceChange: bigint;
    timestamp: number;
}

const PRIVATE_KEY_NAME = "ckb-light-client-wasm-demo-private-key";
const START_BLOCK_KEY_NAME = "ckb-light-client-wasm-demo-start-block";
const SECRET_KEY_NAME = "ckb-light-client-wasm-demo-secret-key";
const Main: React.FC<{}> = () => {
    const [state, setState] = useState<StateLoadingClient | StateClientLoaded | StateAccountGenerated>({ id: StateId.Loadingclient });
    const initFlag = useRef<boolean>(false);

    const [syncedBlock, setSyncedBlock] = useState<bigint>(BigInt(0));
    const [topBlock, setTopBlock] = useState<bigint>(BigInt(0));
    const [startBlock, setStartBlock] = useState<number>(0);

    const [balance, setBalance] = useState<bigint>(BigInt(0));
    const [transactions, setTransactions] = useState<DisplayTransaction[]>([]);
    const [peers, setPeers] = useState<RemoteNode[]>([]);

    const [showSetBlockDialog, setShowSetBlockDialog] = useState(false);
    const [showMakeTransferDialog, setShowMakeTransferDialog] = useState(false);

    const [loading, setLoading] = useState(false);

    // const [debugMode, setDebugMode] = useState(false);

    const loadPrivateKey = useCallback(async (client: LightClient, privateKey: Hex) => {
        const publicKey = hexFrom(secp256k1.getPublicKey(bytesFrom(privateKey), true));
        const signerScript = ccc.Script.from({
            codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
            hashType: "type",
            args: bytesFrom(hashCkb(publicKey)).slice(0, 20)
        })
        const address = ccc.Address.from({ prefix: "ckt", script: signerScript });
        setState({ id: StateId.AccountGenerated, privateKey, publicKey, address, script: signerScript, client });
        return signerScript;
    }, []);
    const generatePrivateKey = async (client: LightClient) => {
        try {
            setLoading(true);
            const privateKey = randomPrivateKey();
            localStorage.setItem(PRIVATE_KEY_NAME, privateKey);
            const signerScript = await loadPrivateKey(client, privateKey);
            const tipHeader = await client.getTipHeader();
            await client.setScripts([
                { blockNumber: tipHeader.number, script: signerScript, scriptType: "lock" }
            ], LightClientSetScriptsCommand.All);
            localStorage.setItem(START_BLOCK_KEY_NAME, tipHeader.number.toString());
        } catch (e) {
            alert(e); console.error(e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (state.id === StateId.Loadingclient) (async () => {
            try {
                if (initFlag.current) return;
                initFlag.current = true;
                console.log("loading")
                const config = await (await fetch(networkConfig)).text();
                console.log("Network config", config);
                const client = new LightClient();
                (window as any).client = client;
                let secretKey = localStorage.getItem(SECRET_KEY_NAME) as Hex | null;
                if (secretKey === null) {
                    secretKey = randomSecretKey();
                    localStorage.setItem(SECRET_KEY_NAME, secretKey as Hex);
                }
                const enableDebug = localStorage.getItem("debug") !== null;
                await client.start({ type: "TestNet", config }, secretKey, enableDebug ? "debug" : "info");
                // setDebugMode(enableDebug);
                let startBlock = localStorage.getItem(START_BLOCK_KEY_NAME);
                if (startBlock === null) {
                    startBlock = "0";
                    localStorage.setItem(START_BLOCK_KEY_NAME, startBlock);
                }
                setStartBlock(parseInt(startBlock));
                setState({ id: StateId.ClientLoaded, client });
                let privateKey = localStorage.getItem(PRIVATE_KEY_NAME) as Hex | null;
                if (privateKey !== null) await loadPrivateKey(client, privateKey);
            } catch (e) { console.error(e); alert(e); } finally { initFlag.current = false; }
        })();
    }, [loadPrivateKey, state]);

    useEffect(() => {
        if (state.id === StateId.AccountGenerated) {
            (async () => {
                const script = state.script;
                while (true) {
                    console.log("Updating block info..");
                    setPeers(await state.client.getPeers());
                    setTopBlock((await state.client.getTipHeader()).number);
                    setSyncedBlock((await state.client.getScripts())[0].blockNumber);

                    const searchKey = {
                        scriptType: "lock",
                        script: script,
                        scriptSearchMode: "prefix",
                    } as ClientCollectableSearchKeyLike;
                    setBalance(await state.client.getCellsCapacity(searchKey));
                    const validateCell = (v: CellOutputLike) => v.lock?.args === script.args && v.lock?.codeHash === script.codeHash && v.lock?.hashType === script.hashType;
                    const txs = await state.client.getTransactions({ ...searchKey, groupByTransaction: true }, "desc") as GetTransactionsResponse<TxWithCells>;
                    const resultTx: DisplayTransaction[] = [];
                    for (const tx of txs.transactions) {
                        // console.log("handler tx", tx);
                        const currTx = tx.transaction as Transaction;
                        const outCapSum = currTx.outputs.filter(validateCell).map(s => s.capacity).reduce((a, b) => a + b, BigInt(0));
                        let inputCapSum = BigInt(0);
                        await (async () => {
                            for (const input of currTx.inputs) {
                                const inputTx = await state.client.fetchTransaction(input.previousOutput.txHash);
                                // console.log("got input tx", inputTx);
                                if (inputTx.status !== "fetched") return;
                                const previousOutput = inputTx.data.transaction.outputs[Number(input.previousOutput.index)];
                                if (validateCell(previousOutput))
                                    inputCapSum += previousOutput.capacity;
                            }
                            // console.log("out cap sum=", outCapSum, "input cap sum=", inputCapSum);
                            const currTxBlockDetail: ClientBlockHeader = (await state.client.getHeader((await state.client.getTransaction(currTx.hash()))!.blockHash!))!;
                            resultTx.push({
                                balanceChange: outCapSum - inputCapSum,
                                timestamp: Number(currTxBlockDetail.timestamp),
                                txHash: currTx.hash()
                            })
                        })()
                    }
                    setTransactions(resultTx);
                    await new Promise((res) => setTimeout(res, 3000));
                }
            })();
        }
    }, [state]);
    const removeAccount = () => {
        localStorage.removeItem(PRIVATE_KEY_NAME);
        localStorage.removeItem(START_BLOCK_KEY_NAME);
        localStorage.removeItem(SECRET_KEY_NAME);
        window.location.reload();
    };
    return <Container style={{ marginTop: "5%", marginLeft: "5%", marginRight: "5%" }}>
        {showSetBlockDialog && <InputNewBlockDialog
            currentBlock={Number(syncedBlock)}
            maxBlock={Number(topBlock)}
            onClose={value => {
                if (value !== undefined) {
                    setStartBlock(value);
                    const currState = (state as StateAccountGenerated);
                    currState.client.setScripts([{
                        script: currState.script,
                        blockNumber: BigInt(value),
                        scriptType: "lock"
                    }], LightClientSetScriptsCommand.All);
                    localStorage.setItem(START_BLOCK_KEY_NAME, value.toString());
                }
                setShowSetBlockDialog(false);
            }}
        ></InputNewBlockDialog>}
        {showMakeTransferDialog && <MakeTransferDialog
            client={(state as StateAccountGenerated).client}
            signerScript={(state as StateAccountGenerated).script}
            currentBalance={balance}
            onClose={() => setShowMakeTransferDialog(false)}
            signerPrivateKey={(state as StateAccountGenerated).privateKey}
        ></MakeTransferDialog>}
        {(state.id === StateId.Loadingclient || loading) && <Dimmer page active><Loader></Loader></Dimmer>}
        <Header as="h1">
            Light Client Wasm Demo
        </Header>
        <Divider></Divider>
        <Segment stacked>
            <Message info>
                <Message.Header>This demo will do the following things through light-client-wasm</Message.Header>
                <Message.List>
                    <Message.Item>Generate a random account on CKB Testnet</Message.Item>
                    <Message.Item>Display recent transactions and balance of this account</Message.Item>
                    <Message.Item>Make transfers</Message.Item>
                </Message.List>
            </Message>
            {state.id === StateId.ClientLoaded && <>
                <Button onClick={() => generatePrivateKey(state.client)}>Generate a private key</Button>
            </>}
            {state.id === StateId.AccountGenerated && <Form>
                <Form.Field>
                    <label>Your private key:</label>
                    {state.privateKey}
                </Form.Field>
                <Form.Field>
                    <label>Your address</label>
                    {state.address.toString()}
                    <Message info>
                        <Message.Header>Tips</Message.Header>
                        <Message.Content>You could claim some CKBs at <a href="https://faucet.nervos.org/" target="_blank" rel="noreferrer">https://faucet.nervos.org/</a></Message.Content>
                    </Message>
                </Form.Field>
                <Form.Field>
                    <label>Synced block</label>
                    {Number(syncedBlock)} / {Number(topBlock)} / {((Number(syncedBlock) - startBlock) / (Number(topBlock) - startBlock) * 100).toFixed(2)}% (started from {startBlock})
                </Form.Field>
                <Form.Field>
                    <label>Balance</label>
                    {Number(balance) / 1e8} CKB
                </Form.Field>
                <Form.Field>
                    <label>Recent transactions</label>
                    <Table>
                        <Table.Header>
                            <Table.Row>
                                <Table.HeaderCell>
                                    Transaction Hash
                                </Table.HeaderCell>
                                <Table.HeaderCell>
                                    Time
                                </Table.HeaderCell>
                                <Table.HeaderCell>
                                    Balance change
                                </Table.HeaderCell>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {transactions.map((item) => {
                                return <Table.Row key={item.txHash}>
                                    <Table.Cell>
                                        <a href={`https://testnet.explorer.nervos.org/transaction/${item.txHash}`} target="_blank" rel="noreferrer">{item.txHash}</a>
                                    </Table.Cell>
                                    <Table.Cell>
                                        {DateTime.fromSeconds(item.timestamp / 1000).toJSDate().toLocaleString()}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {Number(item.balanceChange) / 1e8}
                                    </Table.Cell>
                                </Table.Row>;
                            })}
                        </Table.Body>
                    </Table>
                </Form.Field>
                <Form.Field>
                    <label>Connected Peers</label>
                    <Table compact>
                        <Table.Header>
                            <Table.Row>
                                <Table.HeaderCell>
                                    Node Id
                                </Table.HeaderCell>
                                <Table.HeaderCell>
                                    Connected Duration
                                </Table.HeaderCell>
                                <Table.HeaderCell>
                                    Addresses
                                </Table.HeaderCell>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {peers.map(item => <Table.Row key={item.nodeId}>
                                <Table.Cell>
                                    {item.nodeId}
                                </Table.Cell>
                                <Table.Cell>
                                    {Math.floor(Number(item.connestedDuration) / 1000 / 60)} min
                                </Table.Cell>
                                <Table.Cell>
                                    <List bulleted>
                                        {item.addresses.map(itemAddr => <List.Item style={{ wordBreak: "break-all" }} key={itemAddr.address}>{itemAddr.address} （{Number(itemAddr.score)}）</List.Item>)}
                                    </List>
                                </Table.Cell>
                            </Table.Row>)}
                        </Table.Body>
                    </Table>
                </Form.Field>
                <Divider></Divider>
                <Button onClick={() => setShowSetBlockDialog(true)}>Set start block height</Button>
                <Button onClick={() => setShowMakeTransferDialog(true)}>Transfer</Button>
                <Button onClick={() => removeAccount()}>Remove stored private key</Button>
            </Form>}

        </Segment>
    </Container>
}

export default Main;
