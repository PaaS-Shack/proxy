class Queue {
    constructor(route, proxy) {

        this.route = route;
        this.proxy = proxy;

        this.activeIds = [];
        this.queueIds = [];

        this.map = new Map();
    }
    activeLength() {
        return this.activeIds.length
    }
    queueLength() {
        return this.queueIds.length
    }
    queue(request) {

        if (this.queueLength() > this.route.queueLength) {
            return false
        }


        const id = request.id

        this.map.set(id, request);
        this.queueIds.push(id);

        const exit = () => {
            request.removeListener('end', exit)
            request.removeListener('close', exit)
            this.removeId(id)
            this.process();
            setImmediate(() => this.route.logRequest(request))
        }


        request.once('end', exit);
        request.once('close', exit);
        request.once('timeout', exit);
        request.timer.trigger('queue:add');
        this.process();
        return true
    }
    removeId(id) {
        this.map.delete(id);
        let index = this.queueIds.indexOf(id);
        if (index == -1) {
            index = this.activeIds.indexOf(id);
            if (index != -1) {
                this.activeIds.splice(index, 1);
            }
        } else {
            this.queueIds.splice(index, 1);
        }

    }
    process() {
        if (this.queueLength() > 0 && this.activeLength() < this.route.activeLength) {
            const id = this.queueIds.shift()
            this.activeIds.push(id)
            const request = this.map.get(id)

            request.timer.trigger('queue:remove');

            this.proxy.makeSelection(request);
            
        } else {
            //console.log('wait', this.queueLength(), this.activeLength(), this.route.queueLength)
        }
    }

}

module.exports = Queue