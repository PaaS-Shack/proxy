const BaseStrategy = require("./base");

/**
 * Random strategy class
 *
 * @class RandomStrategy
 */
class RandomStrategy extends BaseStrategy {
    constructor(route, proxy, opts) {
        super(route, proxy, opts);

        this.counter = 0;
        this.name = 'RandomStrategy'
    }
    async select(list) {
        return list[Math.floor(Math.random() * list.length)];
    }
}

module.exports = RandomStrategy;