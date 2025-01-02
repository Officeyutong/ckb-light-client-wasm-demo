# CKB Light Client Wasm Online Demo

You can try this project at https://ckb-light-client-wasm-demo.vercel.app/

This is a simple demo building on light-client-wasm, including these features:
- Generate a random account on testnet
- Show balance and recent transactions of this account
- Send balance to other accounts

## How to build

- Install `wasm-pack` with `cargo install wasm-pack`
- Install `clang`
- Build `ckb-light-client`: `cd ckb-light-client && npm install && npm run build -ws` 
- Build this demo: `yarn install && yarn build`
