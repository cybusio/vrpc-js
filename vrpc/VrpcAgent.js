const os = require('os')
const mqtt = require('mqtt')
const crypto = require('crypto')
const { ArgumentParser } = require('argparse')
const VrpcAdapter = require('./VrpcAdapter')
const EventEmitter = require('events')

/**
 * Agent capable of making existing code available to remote control by clients.
 *
 * @extends EventEmitter
 */
class VrpcAgent extends EventEmitter {

  /**
   * Constructs an agent by parsing command line arguments
   *
   * @param {Object} defaults Allows to specify defaults for the various command line options
   * @param {String} defaults.domain The domain under which the agent-provided code is reachable
   * @param {String} defaults.agent This agent's name
   * @param {String} defaults.username MQTT username (if no token is used)
   * @param {String} defaults.password MQTT password (if no token is provided)
   * @param {String} defaults.token Access token as generated by: https://app.vrpc.io
   * @param {String} defaults.broker Broker url in form: `<scheme>://<host>:<port>`
   * @param {String} defaults.version The (custom) version of this agent
   * @returns {Agent} Agent instance
   *
   * @example const agent = VrpcAgent.fromCommandline()
   */
  static fromCommandline ({
    domain,
    agent,
    token,
    broker,
    username,
    password,
    version
  } = {}) {
    const parser = new ArgumentParser({
      add_help: true,
      description: 'VRPC NodeJS Agent'
    })
    parser.add_argument(
      '-a',
      '--agent',
      {
        help: 'Agent name',
        required: !agent,
        default: agent
      }
    )
    parser.add_argument(
      '-d',
      '--domain',
      {
        help: 'Domain name',
        required: !domain,
        default: domain
      }
    )
    parser.add_argument(
      '-t',
      '--token',
      {
        help: 'Agent Token',
        default: token
      }
    )
    parser.add_argument(
      '-b',
      '--broker',
      {
        help: 'Broker url',
        default: broker || 'mqtts://vrpc.io:8883'
      }
    )
    parser.add_argument(
      '-u',
      '--username',
      {
        help: 'Username',
        default: username
      }
    )
    parser.add_argument(
      '-P',
      '--password',
      {
        help: 'Password',
        default: password
      }
    )
    parser.add_argument(
      '--bestEffort',
      {
        help: 'Calls function on best-effort. Improves performance but may fail under unstable network connections.',
        action: 'store_true'
      }
    )
    parser.add_argument(
      '-V',
      '--version',
      {
        help: 'Agent version. May be checked on the remote side for compatibility checks.',
        required: false,
        default: version
      }
    )
    const args = parser.parse_args()
    return new VrpcAgent(args)
  }

  /**
   * Constructs an agent instance
   *
   * @constructor
   * @param {Object} obj
   * @param {String} obj.domain The domain under which the agent-provided code is reachable
   * @param {String} obj.agent This agent's name
   * @param {String} obj.username MQTT username (if no token is used)
   * @param {String} obj.password MQTT password (if no token is provided)
   * @param {String} obj.token Access token as generated by: https://app.vrpc.io
   * @param {String} [obj.broker='mqtts://vrpc.io:8883'] Broker url in form: `<scheme>://<host>:<port>`
   * @param {Object} [obj.log=console] Log object (must support debug, info, warn, and error level)
   * @param {String} [obj.bestEffort=false] If true, message will be sent with best effort, i.e. no caching if offline
   * @param {String} [obj.version=''] The (user-defined) version of this agent
   *
   * @example
   * const agent = new Agent({
   *   domain: 'public.vrpc'
   *   agent: 'myAgent'
   * })
   */
  constructor ({
    domain,
    agent,
    username,
    password,
    token,
    broker = 'mqtts://vrpc.io:8883',
    log = 'console',
    bestEffort = false,
    version = ''
  } = {}
  ) {
    super()
    this._validateDomain(domain)
    this._validateAgent(agent)
    this._username = username
    this._password = password
    this._token = token
    this._agent = agent
    this._domain = domain
    this._broker = broker
    this._qos = bestEffort ? 0 : 1
    this._version = version
    this._isReconnect = false
    if (log === 'console') {
      this._log = console
      this._log.debug = () => {}
    } else {
      this._log = log
    }
    this._baseTopic = `${this._domain}/${this._agent}`
    VrpcAdapter.onCallback(this._handleVrpcCallback.bind(this))
    // maps clientId to instanceId
    this._unnamedInstances = new Map()
    this._namedInstances = new Map()

    // Handle the internal error event in case the user forgot to implement it
    this.on('error', (err) => {
      this._log.debug(`Encountered an error: ${err.message}`)
    })
  }

  /**
   * Starts the agent
   *
   * The returned promise will only resolve once the agent is connected to the
   * broker. If the connection can't be established it will try connecting
   * forever. You may want to listen to the 'offline' (initial connect attempt
   * failed) or 'reconnect' (any further fail) event and call `agent.end()` to
   * stop trying to connect and resolve the returned promise.
   *
   * If the connection could not be established because of authorization
   * failure, the 'error' event will be emitted.
   *
   * @return {Promise} Resolves once connected or explicitly ended, never
   * rejects
   */
  async serve () {
    const md5 = crypto.createHash('md5')
      .update(this._domain + this._agent).digest('hex').substr(0, 18)
    let username = this._username
    let password = this._password
    if (this._token) {
      username = '__token__'
      password = this._token
    }
    this._options = {
      username,
      password,
      keepalive: 30,
      connectTimeout: 10 * 1000,
      clientId: `vrpca${md5}`,
      rejectUnauthorized: false,
      will: {
        topic: `${this._baseTopic}/__agentInfo__`,
        payload: this._createAgentInfoPayload({ status: 'offline' }),
        qos: this._qos,
        retain: true
      }
    }
    this._log.info(`Domain : ${this._domain}`)
    this._log.info(`Agent  : ${this._agent}`)
    this._log.info(`Broker : ${this._broker}`)
    this._log.info('Connecting to MQTT server...')
    const wasEnded = await this._clearPersistedSession()
    if (wasEnded) return
    this._client = mqtt.connect(
      this._broker,
      { ...this._options, clean: false }
    )
    this._client.on('connect', this._handleConnect.bind(this))
    this._client.on('reconnect', this._handleReconnect.bind(this))
    this._client.on('error', this._handleError.bind(this))
    this._client.on('message', this._handleMessage.bind(this))
    this._client.on('close', this._handleClose.bind(this))
    this._client.on('offline', this._handleOffline.bind(this))
    this._client.on('end', this._handleEnd.bind(this))
    return this._ensureConnected()
  }

  /**
   * Stops the agent
   *
   * @param {Object} [obj]
   * @param {Boolean} [unregister=false] If true, fully un-registers agent from broker
   * @returns {Promise} Resolves when disconnected and ended
   */
  async end ({ unregister = false } = {}) {
    try {
      if (!this._client || !this._client.connected) {
        this.emit('end')
        return
      }
      const agentTopic = `${this._baseTopic}/__agentInfo__`
      this._mqttPublish(
        agentTopic,
        this._createAgentInfoPayload({ status: 'offline' }),
        { retain: true }
      )
      if (unregister) {
        this._mqttPublish(agentTopic, null, { retain: true })
        const classes = this._getClasses()
        for (const className of classes) {
          const infoTopic = `${this._baseTopic}/${className}/__classInfo__`
          this._mqttPublish(infoTopic, null, { retain: true })
        }
      }
      await new Promise(resolve => this._client.end(false, {}, resolve))
      await this._clearPersistedSession()
    } catch (err) {
      this._log.error(
        err,
        `Problem during disconnecting agent: ${err.message}`
      )
    }
  }

  _validateDomain (domain) {
    if (!domain) throw new Error('The domain must be specified')
    if (domain.match(/[+/#*]/)) {
      throw new Error('The domain must NOT contain any of those characters: "+", "/", "#", "*"')
    }
  }

  _validateAgent (agent) {
    if (!agent) throw new Error('The agent must be specified')
    if (agent.match(/[+/#*]/)) {
      throw new Error('The agent must NOT contain any of those characters: "+", "/", "#", "*"')
    }
  }

  _createAgentInfoPayload ({ status }) {
    return JSON.stringify({
      status,
      hostname: os.hostname(),
      version: this._version
    })
  }

  /**
   * @return {Boolean} true if `agent.end()` was explicitly called
   */
  async _clearPersistedSession () {
    // Clear potentially existing persisted sessions
    const client = mqtt.connect(
      this._broker,
      { ...this._options, clean: true }
    )
    client.on('error', (err) => this.emit('error', err))
    client.on('offline', () => this.emit('offline'))
    client.on('reconnect', () => this.emit('reconnect'))
    return new Promise(resolve => {
      client.on('connect', () => {
        client.end(false, {}, () => resolve(false))
      })
      // Will be triggered if the user called 'agent.end()'
      this.once('end', () => {
        client.end()
        resolve(true)
      })
    })
  }

  _mqttPublish (topic, message, options) {
    this._client.publish(topic, message, { qos: this._qos, ...options }, (err) => {
      if (err) {
        this._log.warn(`Could not publish MQTT message because: ${err.message}`)
      }
    })
  }

  _mqttSubscribe (topic, options) {
    this._client.subscribe(topic, { qos: this._qos, ...options }, (err, granted) => {
      if (err) {
        this._log.warn(`Could not subscribe to topic '${topic}', because: ${err.message}`)
      } else {
        if (granted.length === 0) {
          this._log.debug(`Already subscribed to topic '${topic}'`)
        }
      }
    })
  }

  _mqttUnsubscribe (topic, options) {
    this._client.unsubscribe(topic, options, (err) => {
      if (err) {
        this._log.warn(`Could not unsubscribe from topic: ${topic} because: ${err.message}`)
      }
    })
  }

  _getClasses () {
    return VrpcAdapter.getAvailableClasses()
  }

  _getInstances (className) {
    return VrpcAdapter.getAvailableInstances(className)
  }

  _getMemberFunctions (className) {
    return VrpcAdapter.getAvailableMemberFunctions(className)
  }

  _getStaticFunctions (className) {
    return VrpcAdapter.getAvailableStaticFunctions(className)
  }

  _getMetaData (className) {
    return VrpcAdapter.getAvailableMetaData(className)
  }

  async _ensureConnected () {
    return new Promise((resolve) => {
      if (this._client.connected) {
        resolve()
      } else {
        this._client.once('connect', resolve)
      }
    })
  }

  _handleVrpcCallback (jsonString, jsonObject) {
    const { sender } = jsonObject
    try {
      this._log.debug(`Forwarding callback to: ${sender} with payload:`, jsonObject)
      this._mqttPublish(sender, jsonString)
    } catch (err) {
      this._log.warn(
        err,
        `Problem publishing vrpc callback to ${sender} because of: ${err.message}`
      )
    }
  }

  _handleConnect () {
    this._log.info('[OK]')
    if (this._isReconnect) {
      this._publishAgentInfoMessage()
      this.emit('connect')
      this._isReconnect = false
      return
    }
    try {
      const topics = this._generateTopics()
      if (topics.length > 0) this._mqttSubscribe(topics)
    } catch (err) {
      this._log.error(
        err,
        `Problem during initial topic subscription: ${err.message}`
      )
    }
    // Publish agent online
    this._publishAgentInfoMessage()

    // Publish class information
    const classes = this._getClasses()
    classes.forEach(className => {
      this._publishClassInfoMessage(className)
    })
    this.emit('connect')
  }

  _publishAgentInfoMessage () {
    this._mqttPublish(
      `${this._baseTopic}/__agentInfo__`,
      this._createAgentInfoPayload({ status: 'online' }),
      { retain: true }
    )
  }

  _publishClassInfoMessage (className) {
    const json = {
      className: className,
      instances: this._getInstances(className),
      memberFunctions: this._getMemberFunctions(className),
      staticFunctions: this._getStaticFunctions(className),
      meta: this._getMetaData(className)
    }
    try {
      this._mqttPublish(
        `${this._baseTopic}/${className}/__classInfo__`,
        JSON.stringify(json),
        { retain: true }
      )
    } catch (err) {
      this._log.error(
        err,
        `Problem during publishing class info: ${err.message}`
      )
    }
  }

  _generateTopics () {
    const topics = []
    const classes = this._getClasses()
    if (classes.length > 0) {
      this._log.info(`Registering classes: ${classes.join(', ')}`)
    } else {
      this._log.warn('No classes are registered')
    }
    classes.forEach(className => {
      const staticFunctions = this._getStaticFunctions(className)
      staticFunctions.forEach(func => {
        topics.push(`${this._baseTopic}/${className}/__static__/${func}`)
      })
    })
    return topics
  }

  _handleMessage (topic, data) {
    try {
      const json = JSON.parse(data.toString())
      this._log.debug(`Message arrived with topic: ${topic} and payload:`, json)
      const tokens = topic.split('/')
      const [,, className, instance, method] = tokens

      // Special case: clientInfo message
      if (tokens.length === 4 && tokens[3] === '__clientInfo__') {
        this._handleClientInfoMessage(topic, json)
        return
      }

      // Anything else must follow RPC protocol
      if (tokens.length !== 5) {
        this._log.warn(`Ignoring message with invalid topic: ${topic}`)
        return
      }

      // Prepare RPC json
      json.context = instance === '__static__' ? className : instance
      json.method = method

      // Mutates json and adds return value
      VrpcAdapter._call(json)

      // Intersecting life-cycle functions
      let publishClassInfo = false
      switch (method) {
        case '__create__': {
          // TODO handle instantiation errors
          const instanceId = json.data.r
          // TODO await this
          this._subscribeToMethodsOfNewInstance(className, instanceId)
          this._registerUnnamedInstance(instanceId, json.sender)
          break
        }
        case '__createNamed__': {
          // TODO handle instantiation errors
          const instanceId = json.data.r
          if (!this._hasNamedInstance(instanceId)) {
            publishClassInfo = true
            this._subscribeToMethodsOfNewInstance(className, instanceId)
          }
          this._registerNamedInstance(instanceId, json.sender)
          break
        }
        case '__getNamed__': {
          const { data: { _1, e }, sender } = json
          if (!e) this._registerNamedInstance(_1, sender)
          break
        }
        case '__delete__': {
          const { data: { _1 }, sender } = json
          this._unsubscribeMethodsOfDeletedInstance(className, instance)
          const wasNamed = this._unregisterInstance(_1, sender)
          if (wasNamed) publishClassInfo = true
          break
        }
      }
      let jsonString
      try {
        jsonString = JSON.stringify(json)
      } catch (err) {
        this._log.debug(`Failed serialization of return value for: ${json.context}::${json.method}, because: ${err.message}`)
        json.data.r = '__vrpc::not-serializable__'
        jsonString = JSON.stringify(json)
      }
      if (publishClassInfo && method === '__delete__') {
        this._publishClassInfoMessage(className)
      }
      this._mqttPublish(json.sender, jsonString)
      if (publishClassInfo && method === '__createNamed__') {
        this._publishClassInfoMessage(className)
      }
    } catch (err) {
      this._log.error(err, `Problem while handling incoming message: ${err.message}`)
    }
  }

  _handleClientInfoMessage (topic, json) {
    // Client went offline
    const clientId = topic.slice(0, -9)
    if (json.status === 'offline') {
      const entry = this._unnamedInstances.get(clientId)
      if (entry) { // anonymous
        entry.forEach(instanceId => {
          const json = { data: { _1: instanceId }, method: '__delete__' }
          VrpcAdapter._call(json)
          const { data: { r } } = json
          if (r) this._log.debug(`Deleted unnamed instance: ${instanceId}`)
        })
      }
      VrpcAdapter._unregisterEventListeners(clientId)
      this._mqttUnsubscribe(`${clientId}/__clientInfo__`)
    }
  }

  _registerUnnamedInstance (instanceId, clientId) {
    const entry = this._unnamedInstances.get(clientId)
    if (entry) { // already seen
      entry.add(instanceId)
    } else { // new instance
      this._unnamedInstances.set(clientId, new Set([instanceId]))
      if (!this._namedInstances.has(clientId)) {
        this._mqttSubscribe(`${clientId}/__clientInfo__`)
      }
      this._log.info(`Tracking lifetime of client: ${clientId}`)
    }
  }

  _registerNamedInstance (instanceId, clientId) {
    const entry = this._namedInstances.get(clientId)
    if (entry) { // already seen
      entry.add(instanceId)
    } else { // new instance
      this._namedInstances.set(clientId, new Set([instanceId]))
      if (!this._unnamedInstances.has(clientId)) {
        this._mqttSubscribe(`${clientId}/__clientInfo__`)
      }
      this._log.debug(`Tracking lifetime of client: ${clientId}`)
    }
  }

  _hasNamedInstance (instanceId) {
    for (const [, instances] of this._namedInstances) {
      if (instances.has(instanceId)) return true
    }
    return false
  }

  _unregisterInstance (instanceId, clientId) {
    const entryUnnamed = this._unnamedInstances.get(clientId)
    if (entryUnnamed && entryUnnamed.has(instanceId)) {
      entryUnnamed.delete(instanceId)
      if (entryUnnamed.length === 0) {
        this._unnamedInstances.delete(clientId)
        this._mqttUnsubscribe(`${clientId}/__clientInfo__`)
        this._log.debug(`Stopped tracking lifetime of client: ${clientId}`)
      }
      return false
    }
    let found = false
    this._namedInstances.forEach(async (v) => {
      if (v.has(instanceId)) {
        found = true
        v.delete(instanceId)
        if (v.length === 0) {
          this._namedInstances.delete(clientId)
          this._mqttUnsubscribe(`${clientId}/__clientInfo__`)
          this._log.debug(`Stopped tracking lifetime of client: ${clientId}`)
        }
      }
    })
    if (!found) {
      this._log.warn(`Failed un-registering not registered instance: ${instanceId}`)
      return false
    }
    return true
  }

  _subscribeToMethodsOfNewInstance (className, instance) {
    const topic = `${this._baseTopic}/${className}/${instance}/+`
    this._mqttSubscribe(topic)
    this._log.debug(`Subscribed to new topic after instantiation: ${topic}`)
  }

  _unsubscribeMethodsOfDeletedInstance (className, instance) {
    const topic = `${this._baseTopic}/${className}/${instance}/+`
    this._mqttUnsubscribe(topic)
    this._log.debug(`Unsubscribed from topic after deletion: ${topic}`)
  }

  _handleReconnect () {
    this._isReconnect = true
    this._log.warn(`Reconnecting to ${this._broker}`)
    this.emit('reconnect')
  }

  _handleError (err) {
    this.emit('error', err)
  }

  _handleClose () {
    this.emit('close')
  }

  _handleOffline () {
    this.emit('offline')
  }

  _handleEnd () {
    this.emit('end')
  }
}

/**
 * Event 'connect'
 *
 * Emitted on successful (re)connection (i.e. connack rc=0).
 *
 * @event VrpcAgent#connect
 * @type {Object}
 * @property {Boolean} sessionPresent - A session from a previous connection is already present
*/

/**
 * Event 'reconnect'
 *
 * Emitted when a reconnect starts.
 *
 * @event VrpcAgent#reconnect
*/

/**
 * Event 'close'
 *
 * Emitted after a disconnection.
 *
 * @event VrpcAgent#close
 */

/**
 * Event 'offline'
 *
 * Emitted when the client goes offline.
 *
 * @event VrpcAgent#offline
 */

/**
 * Event 'error'
 *
 * Emitted when the client cannot connect (i.e. connack rc != 0) or when a
 * parsing error occurs. The following TLS errors will be emitted as an error
 * event:
 *
 * - ECONNREFUSED
 * - ECONNRESET
 * - EADDRINUSE
 * - ENOTFOUND
 *
 * @event VrpcAgent#error
 * @type {Object} Error
 */

/**
 * Event 'end'
 *
 * Emitted when mqtt.Client#end() is called. If a callback was passed to
 * mqtt.Client#end(), this event is emitted once the callback returns.
 *
 * @event VrpcAgent#end
 */

module.exports = VrpcAgent
