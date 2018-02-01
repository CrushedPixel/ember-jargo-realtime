/* eslint-env node */
'use strict';

module.exports = {
  name: 'ember-jargo-realtime',

  included(app) {
    this._super.included.apply(this, arguments);
    app.import(app.bowerDirectory + '/glue/client/dist/glue.js');
  }
};
