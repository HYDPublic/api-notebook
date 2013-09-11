/* global describe, it, beforeEach, afterEach */

describe('Local Storage Persistence Plugin', function () {
  var id;
  var notebook = '# Testing localStorage';

  beforeEach(function () {
    localstoragePersistencePlugin.attach(App.middleware);
  });

  afterEach(function () {
    App.persistence.reset();
    localstoragePersistencePlugin.detach(App.middleware);
  });

  it('should save to localStorage with a made up id', function (done) {
    App.persistence.set('notebook', notebook);

    App.persistence.save(function (err, content) {
      expect(content).to.equal(notebook);
      expect(id = App.persistence.get('id')).to.exist;

      done();
    });
  });

  it('should load the id from localStorage', function (done) {
    App.persistence.set('id', id);

    App.persistence.load(function (err, content) {
      expect(content).to.equal(notebook);

      localStorage.clear();
      done();
    });
  });
});
