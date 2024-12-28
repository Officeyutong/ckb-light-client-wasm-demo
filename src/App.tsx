import { useEffect, useState } from "react";
import networkConfig from "./config.toml";
import LightClient, { randomSecretKey } from "light-client-js";

const Main: React.FC<{}> = () => {
    const [loading, setLoading] = useState(false);
    const [client, setClient] = useState<null | LightClient>(null);
    useEffect(() => {
        if (client === null) (async () => {
            try {
                setLoading(true);
                const config = await (await fetch(networkConfig)).text();
                const client = new LightClient();
                await client.start({ type: "TestNet", config }, randomSecretKey(), "info");
                setClient(client);
                setLoading(false);
            } catch (e) { console.error(e); }
        })();
    }, [client]);
    return <div style={{ marginTop: "10%", marginLeft: "10%", marginRight: "10%" }}>
        {loading && "loading..11"}
    </div>
}

export default Main;
