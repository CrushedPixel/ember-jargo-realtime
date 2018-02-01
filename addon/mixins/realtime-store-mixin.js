import Ember from 'ember';
import UUID from 'ember-uuid';
import { task } from 'ember-concurrency';

const RealtimeSocket = Ember.Object.extend({

  // socket is the glue instance used for
  // communication with the jargo backend.
  socket: null,
  // onModelUpdated is the function called
  // when a model is updated.
  onModelUpdated: null,
  // onModelDeleted is the function called
  // when a model is deleted.
  onModelDeleted: null,
  connectionMessage: null,

  subscribeCementChannel: null,
  deletedChannel: null,
  updatedChannel: null,

  socketOnError() {
    console.error('socket error', ...arguments)
  },

  socketOnConnected() {
    this.get('socketOnConnectedTask').perform();
  },

  socketOnConnectedTask: task(function*() {
    // TODO: ensure this gets called after reconnecting as well
    const mainChannel = CementChannel.create({
      channel: this.get('socket')
    });

    yield mainChannel.send(yield this.connectionMessage())
  }),

  async subscribe(model, id) {
    return await this.get('subscribeCementChannel').send(JSON.stringify({
      model: model,
      id: id
    }))
  },

  init() {
    this._super(...arguments);
    const socket = this.get('socket');

    socket.on('error', this.socketOnError.bind(this));
    socket.on('connected', this.socketOnConnected.bind(this));

    this.set('subscribeCementChannel', CementChannel.create({
      channel: socket.channel('subscribe')
    }));

    const deletedChannel = socket.channel('deleted');
    deletedChannel.onMessage(this._onModelDeleted.bind(this));
    this.set('deletedChannel', deletedChannel);

    const updatedChannel = socket.channel('updated');
    updatedChannel.onMessage(this._onModelUpdated.bind(this));
    this.set('updatedChannel', updatedChannel);
  },

  _onModelDeleted(data) {
    const message = JSON.parse(data);
    this.get('onModelDeleted')(message.model, message.id);
  },

  _onModelUpdated(data) {
    const message = JSON.parse(data);
    this.get('onModelUpdated')(message.model, message.id, JSON.parse(message.payload));
  }

});

const CementChannel = Ember.Object.extend({

  // cementMessages is an object containing
  // objects containing resolve and reject
  // functions for promises returned by
  // the send function
  cementMessages: null,

  // must be set when creating an instance
  channel: null,

  init() {
    this._super(...arguments);
    this.set('cementMessages', {});
    this.get('channel').onMessage(this.onMessage.bind(this));
  },

  onMessage(message) {
    const data = JSON.parse(message);

    const cementMessages = this.get('cementMessages');
    if (data.status === 0) {
      cementMessages[data.id].resolve(data);
    } else {
      cementMessages[data.id].reject(data);
    }
    delete cementMessages[data.id];
  },

  send(data) {
    return new Promise((resolve, reject) => {
      const id = UUID.v4();
      this.get('channel').send(JSON.stringify({
        id: id,
        data: data
      }));
      this.get('cementMessages')[id] = {resolve, reject};
    });
  }

});

export default Ember.Mixin.create({

  host: null,
  baseURL: '/realtime/',

  // init initializes subscriptions
  // and cementMessages.
  init() {
    this._super(...arguments);
    this.set('subscriptions', {});
    this.set('cementMessages', {});
    this.set('jsonapiModelNames', {});
  },

  // socket is the RealtimeSocket instance
  // being used to communicate with jargo.
  socket: null,

  // subscriptions is an object containing all
  // models the store is subscribed to.
  subscriptions: null,

  // jsonapiModelNames is an object mapping
  // JSON API model names to Ember model names
  jsonapiModelNames: null,

  // shouldSubscribe returns whether to subscribe
  // to a given model instance.
  shouldSubscribe(model) {
    return true;
  },

  // connectionMessage returns a promise resolving
  // with the connection message to send to jargo-realtime.
  async connectionMessage() {
    return 'hi';
  },

  _push() {
    const pushed = this._super.apply(this, arguments);

    if (pushed !== null) {
      let models;
      if (Array.isArray(pushed)) {
        models = pushed.map(internalModel => internalModel.getRecord());
      } else {
        models = [pushed.getRecord()];
      }

      const subscriptions = this.get('subscriptions');
      for (const model of models) {
        if (this.shouldSubscribe(model)) {
          const modelName = model._internalModel.modelName;

          let ids = subscriptions[modelName];
          if (ids === undefined) {
            ids = [];
          }

          // subscribe to model if not yet subscribed
          if (!ids.includes(model.id)) {
            this.get('subscribeTask').perform(modelName, model.id);
            ids.push(model.id);
          }

          subscriptions[modelName] = ids;
        }
      }
    }

    return pushed;
  },

  // getSocket returns the RealtimeSocket instance,
  // initializing it if it doesn't yet exist
  getSocket() {
    let socket = this.get('socket');
    if (socket === null) {
      const glueSocket = glue(this.get('host'), {
        baseURL: this.get('baseURL')
      });

      socket = RealtimeSocket.create({
        socket: glueSocket,
        connectionMessage: this.connectionMessage.bind(this),
        onModelUpdated: this.onModelUpdated.bind(this),
        onModelDeleted: this.onModelDeleted.bind(this)
      });

      this.set('socket', socket);
    }

    return socket;
  },

  subscribeTask: task(function*(modelName, id) {
    // get jsonapi model name from ember model name
    // by calling the respective adapter's pathForType function
    const jsonapiModelName = this.adapterFor(modelName).pathForType(modelName);
    this.get('jsonapiModelNames')[jsonapiModelName] = modelName;
    yield this.getSocket().subscribe(jsonapiModelName, id);
  }),

  onModelUpdated(jsonapiModelName, id, payload) {
    const modelName = this.get('jsonapiModelNames')[jsonapiModelName];
    this.pushPayload(modelName, payload);
  },

  onModelDeleted(jsonapiModelName, id) {
    const modelName = this.get('jsonapiModelNames')[jsonapiModelName];
    this.get('deleteRecordTask').perform(modelName, id);
  },

  deleteRecordTask: task(function*(modelName, id) {
    const record = yield this.find(modelName, id);
    record.deleteRecord();
  })

});
