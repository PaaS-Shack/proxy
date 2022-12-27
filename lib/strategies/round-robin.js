const BaseStrategy = require('./base')


class RoundRobinStrategy extends BaseStrategy {
    constructor(route, proxy, opts) {
        super(route, proxy, opts);

        this.counter = 0;
        this.name = 'RoundRobinStrategy'
    }

    async select(list) {
        // Reset counter
        if (this.counter >= list.length) {
            this.counter = 0;
        }
        return list[this.counter++];
    }
}
module.exports = RoundRobinStrategy