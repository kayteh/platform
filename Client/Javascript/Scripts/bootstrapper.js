// Global scope helper
const self = this

function require (id) {
  id = id.replace('\\', '/')
  id = id.replace(/\.js$/, '')
  return ResourceManager.Require(id)
}

// This is otherwise known as insane.
// Metaprogramming shim to produce the same ExpandoObject structure.
function resourceProxy (resourceName) {
  return new Proxy({}, {
    get (target, name) {
      if (name in target) {
        // check cached
        return target[name]
      } else if (ResourceManager.HasExported(resourceName, name)) {
        // check ResourceManager
        target[name] = require(`${resourceName}/${name}`)
        return target[name]
      } else {
        // Still no? undefined.
        return undefined
      }
    },

    has (target, name) {
      return name in target || ResourceManager.HasExported(resourceName, name)
    },

    ownKeys () {},
    set () {},
    deleteProperty () {},
    apply () {}
  })
}

// . acts like resource as of writing, so.. let's set that up!
const resource = resourceProxy('.')

// Aaaand this is just a resourceProxy but resolves a resource first.
const exported = new Proxy({}, {
  get (target, resourceName) {
    if (resourceName in target) {
      // found the resource? yaaaay!
      return target[resourceName]
    } else if (ResourceManager.HasResource(resourceName)) {
      // So.. we've never been asked before so we'll try to see if it's ever existed.
      target[resourceName] = resourceProxy(resourceName)
      return target[resourceName]
    } else {
      // Oh. Well that sucks for you.
      return undefined
    }
  },

  has (target, name) {
    return name in target || ResourceManager.HasResource(name)
  },

  ownKeys () {},
  set () {},
  deleteProperty () {},
  apply () {}
})

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
    // delete this.chat
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
  constructor (script) {
    this.script = script
    this.API = API
    this.HostString = String
    this.String = ''.constructor
    this.console = new Console(script.Filename)
    this.resource = resource
    this.exported = exported
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
    ResourceManager.Export(module.exports)
  }
}

class SnapshotExporter {
  constructor () {
    this.post = null
    this.pre = null
  }

  process (scope, module) {
    HostLogging.Log('snapshot process: 0')
    let out = {}

    // loop through after-the-fact snapshot, export anything that wasn't there before.
    // this is kinda dumb, we need to depreciate this ASAP.
    for (let prop of this.post) {
      HostLogging.Log('snapshot process: 1 (in-loop)')
      // Exclude global if it's there.
      if (prop === 'global') {
        HostLogging.Log(`snapshot loop: ${prop} - SKIP - was global`)
        continue
      }

      if (!this.pre.has(prop)) {
        HostLogging.Log(`snapshot loop: ${prop} - EXPORT - wasn't in original snapshot`)
        out[prop] = scope[prop]
      } else {
        HostLogging.Log(`snapshot loop: ${prop} - SKIP - we know about`)
      }
    }

    out = Object.assign({}, out, module.exports)
    HostLogging.Log('snapshot process: 2')

    ResourceManager.Export(out)
    HostLogging.Log('snapshot process: 3 (end)')
  }
}

// This function is invoked from the host, sets up the virtual scope, then runs it.
// Also handles exports in a more forward fashion, rather than as an after-thought in 0.1.
function loadScript (script) { // eslint-disable-line no-unused-vars
  try {
    // HostLogging.Log('loadScript')
    //
    // ------ Everything below this line is not in the script's scope ------

    // CommonJS module system magic obj
    const module = { exports: {}, filename: script.Filename, id: script.Filename, loaded: true, parent: null, script }
    // HostLogging.Log('loadScript: 1')

    // Global scope mixin.
    const globalScope = new ResourceGlobalScope(script)
    // HostLogging.Log('loadScript: 2')

    // HostLogging.Log('loadScript: 3')

    // Exporters
    const Snapshots = new SnapshotExporter()
    const cjsExport = new CommonJSExporter()

    // HostLogging.Log('loadScript: 4')

    // ------ Everything above this line is not in the script's scope ------
    //

    // Loader wrapper.
    return (function (module, exports, require, __filename, __dirname) { // eslint-disable-line no-extra-parens
      HostLogging.Log('in wrapper')
      Snapshots.pre = new Set(Object.getOwnPropertyNames(this))

      // add this to scope, it's an analog to process/window/worker when resource was already taken.
      // GUAD FFS.
      const resourceLocal = this

      try {
        // TODO: VM Eval?
        HostLogging.Log('pre-eval')
        eval(script.Script) // eslint-disable-line no-eval
        HostLogging.Log('post-eval')
      } catch (e) {
        HostLogging.Log('EVAL ERROR: ' + (e.stack || e)) // gracefully handle errors
      }

      Snapshots.post = new Set(Object.getOwnPropertyNames(this))

      // resolve export type
      if (resourceLocal.script.ExportMode !== undefined && resourceLocal.script.ExportMode === 'COMMONJS') {
        // COMMONJS - new style (module.exports)
        HostLogging.Log('commonjs export')
        cjsExport.process(module)
      } else {
        // SNAPSHOT - improved old style
        HostLogging.Log('snapshot export')
        Snapshots.process(this, module)
      }
      HostLogging.Log('end wrapper')
    }).call(
      // this w/ mixins
      Object.assign({},
        self,
        globalScope,               // per-script global mixin
        { loadScript: undefined }
      ),

      // Scoped args
      module,           // CommonJS
      module.exports,   // module.exports == exports
      require,          // require, obviously
      module.filename,  // __filename
      ''                // __dirname // TODO: calculate this
    )
  } catch (e) {
    HostLogging.Log('FATAL: ' + (e.stack || e))
  }
}
