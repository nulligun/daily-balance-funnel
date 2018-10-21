# Ellaism Daily Balance Funnel

This is a node app that will monitor a Eth compatible network for balance state changes and keep a daily delta for all active addresses.

## About

This started as a fork of https://github.com/TrustWallet/trust-ray that only included components needed to scan the blockchain for transactions. Eventually
this was replaced with a forward only scanner.

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

Or you can use the following to create the tables from the mysql command line:

```

mysql> create database funnel;
Query OK, 1 row affected (0.00 sec)

mysql> grant all on funnel.* to funnel identified by 'YOUR__PASSWORD__HERE';
Query OK, 0 rows affected (0.01 sec)

mysql> flush privileges;
Query OK, 0 rows affected (0.00 sec)

```

Then import funnel.sql into the database you just created.

`mysql -u funnel -p funnel < funnel.sql`


## Running

`./start_server.sh`