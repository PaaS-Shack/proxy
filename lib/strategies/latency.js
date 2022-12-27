const BaseStrategy = require("./base");

/**
 * Lowest latency invocation strategy
 *
 * Since Strategy can be instantiated multiple times, therefore,
 * we need to have a "master" instance to send ping, and each
 * individual "slave" instance will update their list dynamically
 *
 * These options can be configured in broker registry options:
 *
 * const broker = new ServiceBroker({
 * 	logger: true,
 * 	registry: {
 * 		strategy: "LatencyStrategy",
 * 		strategyOptions: {
 * 			sampleCount: 5,
 * 			lowLatency: 10,
 * 			collectCount: 5,
 * 			pingInterval: 10
 * 		}
 * 	}
 * });
 *
 * @class LatencyStrategy
 */
class LatencyStrategy extends BaseStrategy {
    constructor(route, proxy, opts) {
        super(route, proxy, opts);

        this.opts = {
            sampleCount: 5,
            lowLatency: 10,
            collectCount: 150,
            randomInterval: 1000
        };
        this.count = 0;
        this.name = 'LatencyStrategy'

    }

    /**
     * Select an endpoint by network latency
     *
     * @param {Array<Endpoint>} list
     * @returns {Endpoint}
     * @memberof LatencyStrategy
     */
     async select(list) {
        let minEp = null;
        let minLatency = null;
        this.count++;

        if (this.count < this.opts.collectCount) {
            //console.log(`LatencyStrategy using random ${this.count} < ${this.opts.collectCount}`)
            return list[Math.floor(Math.random() * list.length)];
        }
        if (this.count > this.opts.randomInterval) {
            this.count = 0;
            console.log(`LatencyStrategy  resetting to random ${this.count} < ${this.opts.randomInterval} ${this.route.vHost}`)
            return list[Math.floor(Math.random() * list.length)];
        }

        const sampleCount = this.opts.sampleCount;
        const count = sampleCount <= 0 || sampleCount > list.length ? list.length : sampleCount;
        for (let i = 0; i < count; i++) {
            let ep;
            // Get random endpoint
            if (count == list.length) {
                ep = list[i];
            } else {
                /* istanbul ignore next */
                ep = list[Math.floor(Math.random() * list.length)];
            }
            const epLatency = this.proxy.tracker.getHostLatency(ep.id);

            // Check latency of endpoint
            if (typeof epLatency !== "undefined") {
                if (epLatency < this.opts.lowLatency) return ep;

                if (!minEp || !minLatency || epLatency < minLatency) {
                    minLatency = epLatency;
                    minEp = ep;
                }
            }
        }

        // Return the lowest latency
        if (minEp) {
            return minEp;
        }

        // Return a random item (no latency data)
        return list[Math.floor(Math.random() * list.length)];
    }
}

module.exports = LatencyStrategy;