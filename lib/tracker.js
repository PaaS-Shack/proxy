const Noc = require('./noc')

class Tracker {
    constructor(broker, logs, metrics) {
        this.events = [];
        this.broker = broker;
        this.logs = logs;
        this.metrics = metrics
        this.noc = new Noc(broker)
        this.noc.start()
        this.latencyLength = 50;

        this.stats = {}
        this.timer = setInterval(() => {

        }, 1000);
    }
    log(...args) {
        this.broker.logger.info(...args)
    }
    stop() {
        clearInterval(this.timer);
        this.noc.stop()
    }
    toJSON(vHost) {
        const result = {};
        const stats = this.stats;

        if (vHost) {
            result.hosts = {};
            result.routes = {};
            if (stats['routes'][vHost])
                result.routes[vHost] = stats['routes'][vHost].toJSON();
        } else {
            Object.keys(stats).forEach(type => {
                result[type] = {};
                Object.keys(stats[type]).forEach(key => {
                    result[type][key] = stats[type][key].toJSON();
                });
            });
        }

        return result;
    }
    getHostLatency(id) {
        if (this.stats.hosts && this.stats.hosts[id]) {
            return this.stats.hosts[id].latencyAvg
        }
        return null;
    }
    getStat(type, key) {
        if (!this.stats[type]) {
            this.stats[type] = {};
        }
        let stat = this.stats[type][key];
        if (!stat) {
            stat = this.createStat(type, key)
        }
        return stat;
    }
    createStat(type, key) {

        if (!this.stats[type]) {
            this.stats[type] = {};
        }

        const object = this.stats[type][key] = {
            hits: 0,
            hitsTotal: 0,
            misses: 0,
            missesTotal: 0,
            errorsCount: 0,
            errors: {},
            codes: {},
            latencyAvg: 0,
            latency: [],
            reset: () => {
                clearTimeout(object.timer)
                object.timer = setTimeout(() => {
                    delete this.stats[type][key]
                }, 15 * 60 * 1000)
            },
            clear: () => {
                object.missesTotal += object.misses;
                object.hitsTotal += object.hits;


                object.misses = 0;
                object.hits = 0;
                object.errorsCount = 0;
                object.codes = {};
            },
            toJSON: (latency = true) => {
                const stats = {
                    hits: object.hits,
                    hitsTotal: object.hitsTotal,
                    missesTotal: object.missesTotal,
                    misses: object.misses,
                    errors: object.errors,
                    codes: object.codes,
                    latencyAvg: object.latencyAvg
                }

                if (latency) {
                    stats.latency = object.latency
                }

                return stats
            },
            timer: 0
        };

        return object
    }
    setLatancy(stat, time) {
        stat.latency.push(time);

        if (stat.latency.length > this.latencyLength) {
            stat.latency.shift();
        }
        stat.latencyAvg = stat.latency.reduce((accumulator, currentValue) => accumulator + currentValue) / stat.latency.length
    }
    setStatusCode(stat, statusCode) {
        if (!stat.codes[statusCode]) {
            stat.codes[statusCode] = 0;
        }
        stat.codes[statusCode]++;
    }
    setError(stat, error) {
        if (!stat.errors[error.code]) {
            stat.errors[error.code] = 0
        }
        stat.errors[error.code]++
        stat.errorsCount++;
    }
    missed(request) {
        const { vHost } = request;

        let route = this.getStat('routes', vHost)
        route.misses++;
    }
    trackRequest(request) {

        const { vHost } = request;

        let route = this.getStat('routes', vHost)

        route.reset();

        const totalTime = request.timer.time('start', 'end');

        this.setLatancy(route, totalTime);

        const statusCode = request.getStatusCode();

        this.setStatusCode(route, statusCode)

        const hasError = request.hasError();

        if (hasError) {
            const error = request.getError();
            this.setError(route, error)
        } else {
            route.hits++;
        }

        const target = request.getTarget();

        let hostTime = null;
        let ququeTime = request.timer.time('queue:add', 'queue:remove');

        if (target) {
            hostTime = target.end - target.start;
        }
        let processTime = totalTime - (ququeTime + hostTime == null ? 0 : hostTime)
        //this.logRequest(request, route, processTime)


        this.noc.reportHTTP(request)

    }
    logRequest(request, stat, processTime) {
        console.log(`
Request log
ID:${request.id}
host:${request.host}
retries:${request.retries}
statusCode:${request.statusCode}
sent:end:${request.sent.end}
sent:headers:${request.sent.headers}
vHost:${request.vHost}
processTime:${processTime}
events: 
${request.timer.print().join('\n')}
`)


        console.log(`host:`)

        console.log(request.host)
        console.log(`stat:`)
        console.log(stat)

        console.log(`Request log end`)
    }
    reset() {
        const types = Object.keys(this.stats)
        for (let index = 0; index < types.length; index++) {
            const type = types[index];
            const keys = Object.keys(this.stats[type])
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                this.stats[type][key].hitsTotal += this.stats[type][key].hits;
                this.stats[type][key].hits = 0
            }

        }
    }
    trackTarget(request) {
        const target = request.getTarget();
        if (target) {

            const hostID = target.getHostID();

            let host = this.getStat('hosts', hostID)

            host.reset();


            const latancy = target.end - target.start;

            this.setLatancy(host, latancy);

            const statusCode = request.getStatusCode();

            this.setStatusCode(host, statusCode)

            const hasError = request.hasError();

            if (hasError) {
                const error = request.getError();
                this.setError(host, error)
            } else {
                host.hits++;
            }

        }
        if (request.ended) {
            this.trackRequest(request);
        }
    }
}
module.exports = Tracker