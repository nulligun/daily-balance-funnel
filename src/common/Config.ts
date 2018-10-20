const Web3 = require("web3");
const config = require("config");

export class Config {
    static network = config.get("RPC_SERVER");
    static web3 = new Web3(new Web3.providers.HttpProvider(Config.network));

    public static initWeb3() {
        Config.web3.extend({
            methods: [{
                name: 'getBalanceStateChanges',
                call: 'trace_replayTransaction',
                params: 2,
                outputFormatter: function(state : any) {
                    let stateDiff = state['stateDiff'];
                    let result = Object.keys(stateDiff).map((address) => {
                        if (stateDiff[address]['balance']['*']) {
                            let b1 = Config.web3.utils.toBN(stateDiff[address]['balance']['*']['from']);
                            let b2 = Config.web3.utils.toBN(stateDiff[address]['balance']['*']['to']);
                            return {address: address, delta: b2.sub(b1)};
                        }
                        return {address: address, delta: "0"};
                    });
                    return result;
                }
            }]
        });
    }
}
