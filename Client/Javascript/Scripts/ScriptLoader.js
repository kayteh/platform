// Global scope helper
const self = this

// Simple but powerful console.log provider.
// This is well-documented in ScriptLoader.md
class Console {
  constructor (path, logIface = null, { prefixes = {} } = {}) {
    this.path = path
    this.prefixes = prefixes

    try {
      this._sl = (logIface === null) ? HostLogging.Log : logIface
    } catch (e) {
      this._sl = API.sendChatMessage
      this._sl('~r~Console Build Error!~w~ ' + e)
    }
  }

  get chat () {
    delete this.chat
    this.chat = new Console(this.path, API.sendChatMessage, {
      prefixes: {
        error: '~r~~h~ERROR:~h~~w~',
        warn: '~y~WARN:~w~',
        info: '~b~INFO:~w~'
      }
    })
    return this.chat
  }

  get notify () {
    delete this.notify
    this.notify = new Console(this.path, (str) => {
      str.split('\0').forEach((part) => {
        API.sendNotification(part)
      })
    }, {
      prefixes: {
        error: '~r~~h~ERROR:~h~~w~\0',
        warn: '~y~WARN:~w~\0',
        info: '~b~INFO:~w~\0'
      }
    })
    return this.notify
  }

  custom (iface, extra = {}) {
    return new Console(this.path, iface, extra)
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
    }).join(' ').trim()
    this._sl(outStr)
  }

  error (...args) {
    args.unshift(this.prefixes.error || 'ERROR:')
    this.log.apply(this, args)
  }

  warn (...args) {
    args.unshift(this.prefixes.warn || 'WARN:')
    this.log.apply(this, args)
  }

  info (...args) {
    args.unshift(this.prefixes.info || 'INFO:')
    this.log.apply(this, args)
  }
}

// This is everything the resource needs, except types.
// TODO: Fill in extra gaps with host functions.
class ResourceGlobalScope {
  get API () { return API }
  get String () { return ''.constructor }
  get HostString () { return String }
  get resource () { return resource }
  get exported () { return exported }
  get console () {
    delete this.console
    this.console = new Console(this.script.Filename)
  }
  set script (val) {
    delete this.script
    this.script = Object.freeze(val)
  }
  // btoa (str to base64)
  // atob (base64 to str)
  // fetch?? (http client)
  // set/clearInterval (repeating timer)
  // set/clearTimeout (single-fire timer)
}

// Nice clean and simple module.exports glue.
class CommonJSExporter {
  process (module) {
    HostExporter.Export(module.exports)
  }
}

class SnapshotExporter {
  constructor () {
    this.post = null // Set
    // this.pre -- see setter // Set
  }

  set pre (val) {
    delete this.pre
    this.pre = val
  }

  process (scope, module) {
    let out = {}

    // loop through after-the-fact snapshot, export anything that wasn't there before.
    // this is kinda dumb, we need to depreciate this ASAP.
    for (let prop of this.post) {
      // Exclude global if it's there.
      if (prop === 'global') {
        continue
      }

      if (!this.pre.has(prop)) {
        out[prop] = scope[prop]
      }
    }

    out = Object.assign({}, out, module.exports)

    HostExporter.Export(out)
  }
}

// This function is invoked from the host, sets up the virtual scope, then runs it.
// Also handles exports in a more forward fashion, rather than as an after-thought in 0.1.
function loadScript (script) { // eslint-disable-line no-unused-vars
  //
  // ------ Everything below this line is not in the script's scope ------

  // CommonJS module system magic obj
  const module = { exports: {}, filename: script.Filename, id: script.Filename, loaded: true, parent: null, script }

  // Global scope mixin.
  const globalScope = new ResourceGlobalScope(script)
  globalScope.script = script

  // Exporters
  const Snapshots = new SnapshotExporter()
  const cjsExport = new CommonJSExporter()

  // ------ Everything above this line is not in the script's scope ------
  //

  // Loader wrapper.
  return (function (module, exports, require, __filename, __dirname) { // eslint-disable-line no-extra-parens
    Snapshots.pre = new Set(Object.getOwnPropertyNames(this))

    // add this to scope, it's an analog to process/window/worker when resource was already taken.
    // GUAD FFS.
    const global = this

    try {
      // TODO: VM Eval?
      eval(script.Script) // eslint-disable-line no-eval
    } catch (e) {
      global.console.error(e.trace) // gracefully handle errors
      global.console.notify.error(e.name)
    }

    Snapshots.post = new Set(Object.getOwnPropertyNames(this))

    // resolve export type
    if (global.script.ExportMode === 'SNAPSHOT') {
      // SNAPSHOT - improved old style
      Snapshots.process(this, module)
    } else {
      // COMMONJS - new style (module.exports)
      cjsExport.process(module)
    }
  }).call(
    // this w/ mixins
    Object.assign({},
      self,                      // actual global scope for types
      globalScope,               // per-script global mixin
      { loadScript: undefined }  // mix-out this function to prevent eval exploiting.
    ),

    // Scoped args
    module,           // CommonJS
    module.exports,   // module.exports == exports
    require,          // require, obviously
    module.filename,  // __filename
    ''                // __dirname // TODO: calculate this
  )
}
