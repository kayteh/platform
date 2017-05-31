class Console {
  constructor (path, logIface = null) {
    this.path = path
    try {
      this._sl = (logIface === null) ? HostLogging.Log : logIface
    } catch (e) {
      this._sl = API.sendChatMessage
      this._sl('~r~Console Build Error!~w~ ' + e)
    }
  }

  chat () {
    return new Console(this.path, API.sendChatMessage)
  }

  notify () {
    return new Console(this.path, API.sendNotification)
  }

  custom (iface) {
    return new Console(this.path, iface)
  }

  log (...args) {
    const outStr = args.map(x => {
      try {
        if (typeof x === 'string') {
          return x
        }

        if (x === Object(x)) {
          try {
            return API.toJson(x)
          } catch (e) {
            return '' + x
          }
        }

        if (Array.isArray(x)) {
          return JSON.stringify(x)
        }

        return '' + x
      } catch (e) {
        return '' + x
      }
    }).join(' ')
    this._sl(outStr)
  }

  error (...args) {
    args.unshift('ERROR:')
    this.log.apply(this, args)
  }

  warn (...args) {
    args.unshift('WARN:')
    this.log.apply(this, args)
  }

  info (...args) {
    args.unshift('INFO:')
    this.log.apply(this, args)
  }
}

function loadScript (script) { // eslint-disable-line no-unused-vars
  const exports = {}
  const module = { exports, info: { loaded: true, script } }
  const console = new Console(script.Filename)
  return (function (require, module, exports, API, console) {
    try {
      eval(script.Script) // eslint-disable-line no-eval
    } catch (e) {
      console.error(e.trace)
    }
  })(require, module, exports, API, console)
}
