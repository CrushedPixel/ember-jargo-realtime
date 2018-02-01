module.exports = {
  normalizeEntityName() {
  },

  afterInstall() {
    return this.addBowerPackageToProject('glue-socket');
  }
};
