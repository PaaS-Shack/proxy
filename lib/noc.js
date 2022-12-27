
class Noc {
    constructor(broker) {
        this.broker = broker;
    }
    start() { }
    stop() { }

    reportHTTP(request) {

        this.broker.emit('noc.http', {
            ip: request.connection.remoteAddr,
            meta: {
                method: request.method,
                vHost: request.vHost,
                url: request.url,
                time: request.timer.time('start', 'end'),
                statusCode: request.getStatusCode(),
                hasError: request.hasError(),
                agent:request.req.headers['user-agent']
            }
        });
    }
}
module.exports = Noc