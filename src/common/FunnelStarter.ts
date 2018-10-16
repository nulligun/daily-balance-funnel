import { BlockchainParser } from "./BlockchainParser";
import { BlockchainState } from "./BlockchainState";
import { Database } from "../models/Database";
import { setDelay } from "./Utils";
const config = require("config");

const parser = new BlockchainParser();
const blockchainState = new BlockchainState();

export class FunnelStarter {
    private db : Database;

    constructor() {
        this.db = new Database(config.get("MONGO.URI"));
        this.db.connect();
    }

    start(): void {
        blockchainState.getState().then(() => {
            this.startParsers()
        }).catch(() => {
            setDelay(5000).then(() => {
                this.start()
            })
        })
    }

    startParsers(): void {
        parser.start();
    }
}
