const events = require('events');

const Queue = require('./queue');
const Host = require('./host');
const RoundRobinStrategy = require('./strategies/round-robin')
const RandomStrategy = require('./strategies/random')
const LatencyStrategy = require('./strategies/latency')



class Route extends events.EventEmitter {
    constructor(broker, balancer, vHost, Strategy = RoundRobinStrategy) {
        super();
        this.broker = broker;
        this.balancer = balancer;
        this.vHost = vHost;

        this.strategy = new Strategy(this, balancer);

        this.clusterName = balancer.settings.clusterName

        this.hosts = new Map();
        this.requests = new Map();
        this.queue = new Queue(this, balancer);

        this.autoHTTPS = true;

        this.maintenance = false;
        this.queueLength = 100;
        this.activeLength = 50;
        this.headers = []

        this.authCaller = null;

    }
    setStrategy(strategy) {
        this.strategy = strategy;
    }
    setHeaders(headers) {
        this.headers = headers
    }
    setMaintenance(maintenance = false) {
        this.maintenance = maintenance;
    }
    toJSON() {
        const hosts = {};
        for (var [key, value] of this.hosts.entries()) {
            hosts[key] = value.toJSON();
        }
        return {
            queueLength: this.queue.queueLength(),
            queueLengthMax: this.queueLength,
            activeLength: this.queue.activeLength(),
            activeLengthMax: this.activeLength,
            hostCount: this.hosts.size,
            strategy: this.strategy.name,
            clusterName: this.clusterName,
            maintenance: this.maintenance,
            headers: this.headers,
            authCaller: this.authCaller,
            hosts
        }
    }

    queueRequest(request) {

        const quequed = this.queue.queue(request)
        if (!quequed) {
            this.balancer.tracker.missed(request)
            request.errorMessage(`bad gateway. (${request.vHost})`, 500);
        }
    }
    setAuth(caller) {
        this.authCaller = caller;
    }
    getAuthCaller() {
        return this.authCaller;
    }
    hasAuth() {
        return this.authCaller != null;
    }


    addHost(hostObject) {
        const { id, host, port } = hostObject;
        let found = this.hosts.get(id);
        if (found) {
            return found;
        }

        found = new Host(hostObject);

        this.hosts.set(id, found)

        this.strategy.addHost(found)

        return found
    }
    removeHost(id) {
        this.strategy.removeHost(this.hosts.get(id))
        this.hosts.delete(id)
    }
    getHost(id) {
        this.hosts.get(id);
    }
    markHostStillDead(host, report = true) {
        const target = this.hosts.get(host.id);

        if (!target) {
            return false;
        }
        if (!target.dead)
            return false;
        if (!target.retry)
            return false;

        target.markDead();

        return true
    }
    markHostAlive(host, report = true) {
        const target = this.hosts.get(host.id);

        if (!target) {
            return false;
        }
        if (!target.dead)
            return false;

        target.clearDead();

        return true
    }
    markHostDead(host, report = true) {

        const target = this.hosts.get(host.id);

        if (!target) {
            return false;
        }
        if (target.dead)
            return false;

        target.markDead();

        if (report)
            this.broker.broadcast('routes.hosts.dead', {
                vHost: this.vHost,
                host: target
            })


        return true
    }
    hostCount() {
        return Array.from(this.hosts.values()).length
    }
    hostFilter(host) {
        if (host.dead) {
            return host.tryAgain();
        }
        return true
    }
    getHosts() {
        return Array.from(this.hosts.values()).filter((host) => host.cluster == this.clusterName || host.cluster == 'default')
    }
    async select(request) {

        let hosts = this.getHosts().filter((host) => this.hostFilter(host))
        if (hosts.length == 0) {
            hosts = this.getHosts();
        }
        const selected = await this.strategy.select(hosts, request);


        return selected
    }

    logRequest(request) {
        //console.log('logRequest',request)
    }

    setAutoHTTPS(autoHTTPS) {
        return this.autoHTTPS = !!autoHTTPS;
    }

    hasSecureContext() {
        return !!this.secureContext;
    }
    setSecureContext(secureContext) {
        this.secureContext = secureContext
    }
    getSecureContext() {
        return this.secureContext;
    }

}
module.exports = Route