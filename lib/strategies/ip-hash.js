const BaseStrategy = require("./base");
const HashRing = require('hashring');
const Host = require("../host");
/**
 * Random strategy class
 *
 * @class IPHashStrategy
 */
class IPHashStrategy extends BaseStrategy {
    constructor(route, proxy, opts) {
        super(route, proxy, opts);

        this.ring = new HashRing([]);
        this.list = {}

        this.counter = 0;
        this.name = 'IPHashStrategy'
    }
    async select(list, request) {
        const ip = request.connection.remoteAddr
        const id = this.ring.get(ip)
        return this.list[id]
    }

    addHost(host) {
        this.list[host.id] = host;

        const options = {}
        options[host.id] = host

        this.ring.add(options)
    }
    removeHost(host) {
        this.ring.remove(host.id);
        delete this.list[host.id];
    }
}

module.exports = IPHashStrategy;