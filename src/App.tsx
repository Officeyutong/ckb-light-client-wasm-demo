import { useEffect, useRef, useState } from "react";
import networkConfig from "./config.toml";
import { LightClient, LightClientSetScriptsCommand, randomSecretKey } from "light-client-js";
import { Button, Container, Dimmer, Divider, Form, Header, Loader, Message, Segment } from "semantic-ui-react";
import 'semantic-ui-css/semantic.min.css'
import { bytesFrom, ccc, hashCkb, Hex, hexFrom } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1";
import InputNewBlockDialog from "./InputNewBlockDialog";
import { ClientCollectableSearchKeyLike } from "@ckb-ccc/core/dist.commonjs/advancedBarrel";
import { GetTransactionsResponse, TxWithCells } from "light-client-js/dist/types";
enum StateId {
    Loadingclient = 1,
    ClientLoaded = 2
}

interface StateLoadingClient {
    id: StateId.Loadingclient;
}

interface StateClientLoaded extends Omit<StateLoadingClient, "id"> {
    id: StateId.ClientLoaded;
    client: LightClient;
    privateKey: Hex;
    publicKey: Hex;
    address: ccc.Address;
    script: ccc.Script;
}

const generatePrivateKey = () => {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return hexFrom(buf);
};

const PRIVATE_KEY_NAME = "ckb-light-client-wasm-demo-private-key";
const START_BLOCK_KEY_NAME = "ckb-light-client-wasm-demo-start-block";
const Main: React.FC<{}> = () => {
    const [state, setState] = useState<StateLoadingClient | StateClientLoaded>({ id: StateId.Loadingclient });
    const initFlag = useRef<boolean>(false);

    const [syncedBlock, setSyncedBlock] = useState<bigint>(BigInt(0));
    const [topBlock, setTopBlock] = useState<bigint>(BigInt(0));
    const [startBlock, setStartBlock] = useState<number>(0);

    const [balance, setBalance] = useState<bigint>(BigInt(0));
    const [transactions, setTransactions] = useState<TxWithCells[]>([]);


    const [showSetBlockDialog, setShowSetBlockDialog] = useState(false);
    useEffect(() => {
        if (state.id === StateId.Loadingclient) (async () => {
            try {
                if (initFlag.current) return;
                initFlag.current = true;
                console.log("loading")
                const config = await (await fetch(networkConfig)).text();
                const client = new LightClient();
                (window as any).client = client;
                await client.start({ type: "TestNet", config }, randomSecretKey(), "info");
                let privateKey = localStorage.getItem(PRIVATE_KEY_NAME) as Hex | null;
                if (privateKey === null) {
                    privateKey = generatePrivateKey();
                    localStorage.setItem(PRIVATE_KEY_NAME, privateKey);
                }
                let startBlock = localStorage.getItem(START_BLOCK_KEY_NAME);
                if (startBlock === null) {
                    startBlock = "0";
                    localStorage.setItem(START_BLOCK_KEY_NAME, startBlock);
                }
                const publicKey = hexFrom(secp256k1.getPublicKey(bytesFrom(privateKey), true));
                const signerScript = ccc.Script.from({
                    codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                    hashType: "type",
                    args: bytesFrom(hashCkb(publicKey)).slice(0, 20)
                })
                const address = ccc.Address.from({ prefix: "ckt", script: signerScript });
                const currentScripts = await client.getScripts();
                if (currentScripts.find(v => v.script.args === signerScript.args && v.script.codeHash === signerScript.args && v.script.hashType === signerScript.hashType) === undefined) {
                    console.log("Setting scripts");
                    await client.setScripts([{
                        script: signerScript,
                        blockNumber: BigInt(startBlock),
                        scriptType: "lock"
                    }], LightClientSetScriptsCommand.All);
                }
                setStartBlock(parseInt(startBlock));
                setState({ id: StateId.ClientLoaded, client, privateKey, publicKey, address, script: signerScript });
                (async () => {
                    while (true) {
                        console.log("Updating block info..");
                        setTopBlock((await client.getTipHeader()).number);
                        setSyncedBlock((await client.getScripts())[0].blockNumber);
                        const searchKey = {
                            scriptType: "lock",
                            script: signerScript,
                            scriptSearchMode: "prefix",
                            withData: false,
                        } as ClientCollectableSearchKeyLike;
                        setBalance(await client.getCellsCapacity(searchKey));
                        const txs = await client.getTransactions({ ...searchKey, groupByTransaction: true }, "desc", 5) as GetTransactionsResponse<TxWithCells>;
                        setTransactions(txs.transactions);
                        await new Promise((res) => setTimeout(res, 3000));
                    }
                })();
            } catch (e) { console.error(e); alert(e); } finally { initFlag.current = false; }
        })();
    }, [state]);
    return <Container style={{ marginTop: "5%", marginLeft: "5%", marginRight: "5%" }}>
        {showSetBlockDialog && <InputNewBlockDialog
            currentBlock={Number(syncedBlock)}
            maxBlock={Number(topBlock)}
            onClose={value => {
                if (value !== undefined) {
                    setStartBlock(value);
                    const currState = (state as StateClientLoaded);
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
        {(state.id === StateId.Loadingclient) && <Dimmer page active><Loader></Loader></Dimmer>}
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
            {state.id === StateId.ClientLoaded && <Form>
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
            </Form>}
            <Divider></Divider>
            <Button onClick={() => setShowSetBlockDialog(true)}>Set start block height</Button>
        </Segment>
    </Container>
}

export default Main;
