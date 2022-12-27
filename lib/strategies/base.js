class BaseStrategy {
    constructor(route, proxy, opts) {
        this.route = route;
        this.proxy = proxy;
        this.opts = opts || {};
        this.name = 'BaseStrategy'
    }

    select(/*list, ctx*/) {
        /* istanbul ignore next */
        throw new Error("Not implemented method!");
    }
    addHost() { }
    removeHost() { }
}
module.exports = BaseStrategy