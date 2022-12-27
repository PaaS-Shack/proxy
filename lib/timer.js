class Timer {
    constructor(type) {
        this.events = [];
        this.type = type;
    }
    trigger(name) {
        this.events.push({
            name,
            time: Date.now()
        })
        // if (name == 'end' || name == 'close')
        //console.log(this.type, this.events)
    }
    time(startName, endName) {
        let start = this.events.find((event) => event.name == startName);
        if (!start) start = this.events[0]
        let end = this.events.find((event) => event.name == endName);
        if (!end) end = this.events[this.events.length - 1];

        return end.time - start.time;
    }
    print() {
        const events = [...this.events]
        const start = events.shift();
        const result = [];
        for (let index = 0; index < events.length; index++) {
            const event = events[index];
            result.push(`${event.name}:${event.time - start.time}`)
        }
        return result
    }
}
module.exports = Timer