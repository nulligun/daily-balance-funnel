# Ellaism Daily Balance Funnel

This is a node app that will monitor a Eth compatible network for balance state changes and keep a daily delta for all active addresses.

## About

This a fork of https://github.com/TrustWallet/trust-ray that only includes components needed to scan the blockchain for transactions. It's not
a drop in replacement.  The HTTP api has been removed and it only stores a daily balance change in SQL as opposed to full transaction details.

It was created to be the backend for the [Ellaism Historical Balance Tool](https://github.com/stevemulligan/bellance)


## Requirements

An Ethereum client that supports the `trace_replayTransaction` is required. This is only tested so far with Parity.

You must run parity with a few extra command line options. This will increase the storage requirements quite a bit.  For an Ethereum main network you will probably need > 2TB of storage as of Fall 2018.  For Ellaism this is 32GB as opposed to about 4GB as of Fall 2018.

parity --chain ellaism --tracing on --pruning archive


## Building

```
npm install
npm run build
```

## Setup

Edit config/default.json to point to your mongo instance, MySQL server and Eth RPC Endpoint.

Use `python3 create_tables.py` from the [Ellaism Historial Balance Tool](https://github.com/stevemulligan/bellance) to create the database tables.


## Running

`./start_server.sh`