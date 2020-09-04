describe('Ravel PostgreSQL Provider integration test', () => {
  let Ravel, Routes, mapping, transaction, app;

  beforeEach(async () => {
    // scaffold basic Ravel app
    Ravel = require('ravel');
    Routes = Ravel.Routes;
    mapping = Routes.mapping;
    transaction = Routes.transaction;
    app = new Ravel();
    app.set('port', Math.floor(Math.random() * 10000) + 10000);
    app.set('log level', app.$log.NONE);
    app.registerProvider(require('../../lib/ravel-postgresql-provider'));
    app.set('postgresql options', {
      user: 'ravel',
      password: 'password',
      port: 15432
    });
    app.set('keygrip keys', ['mysecret']);

    @Ravel.Module('dal')
    @transaction
    @Ravel.autoinject('$db')
    class TestModule {
      @Ravel.Module.prelisten
      init () {
        return this.$db.scoped('postgres', async function (ctx) {
          await new Promise((resolve, reject) => {
            ctx.transaction.postgresql.query('DROP TABLE IF EXISTS test', (err, rows) => {
              if (err) { return reject(err); }
              resolve(rows);
            });
          });
          await new Promise((resolve, reject) => {
            ctx.transaction.postgresql.query('CREATE TABLE test (id INT)', (err, rows) => {
              if (err) { return reject(err); }
              resolve(rows);
            });
          });
        });
      }

      retrieve (ctx) {
        return new Promise((resolve, reject) => {
          ctx.transaction.postgresql.query('SELECT * from test', (err, rows) => {
            if (err) { return reject(err); }
            ctx.body = rows;
            resolve(rows);
          });
        });
      }

      insert (ctx) {
        return new Promise((resolve, reject) => {
          ctx.transaction.postgresql.query('INSERT INTO test VALUES (1)', (err, rows) => {
            if (err) { return reject(err); }
            ctx.body = rows;
            resolve(rows[0]);
          });
        });
      }

      update (ctx) {
        return new Promise((resolve, reject) => {
          ctx.transaction.postgresql.query('UPDATE test SET ID = :id', {id: 2}, (err, rows) => {
            if (err) { return reject(err); }
            ctx.body = rows;
            resolve(rows[0]);
          });
        });
      }
    }

     @Routes('/')
     @transaction
     @Ravel.autoinject('dal')
    class TestRoutes {
       @mapping(Routes.GET, 'ids')
      async getIds (ctx) {
        await this.dal.retrieve(ctx);
      }

       @mapping(Routes.POST, 'error')
      async postError (ctx) {
        await this.dal.insert(ctx);
        throw new Error();
      }

       @mapping(Routes.POST, 'commit')
      async postCommit (ctx) {
        await this.dal.insert(ctx);
      }

       @mapping(Routes.PUT, 'update')
      async putCommit (ctx) {
        await this.dal.update(ctx);
      }
    }
    app.load(TestModule, TestRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('#prelisten()', () => {
    it('should create a generic pool of connections', async (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      expect(provider.pool).toHaveProperty('acquire');
      expect(provider.pool.acquire).toBeInstanceOf(Function);
      expect(provider.pool).toHaveProperty('release');
      expect(provider.pool.release).toBeInstanceOf(Function);
      expect(provider.pool).toHaveProperty('destroy');
      expect(provider.pool.destroy).toBeInstanceOf(Function);
      app.close();
      done();
    });

    it.skip('should create a pool which destroys connections when they error out', async (done) => {
      const pg = require('pg'); // eslint-disable-line no-unused-vars
      jest.mock('pg', () => {
        return jest.fn().mockImplementation(() => {
          const connectError = new Error();
          const EventEmitter = require('events');
          class StubClient extends EventEmitter {
            connect (cb) {
              console.log('Killing myself');
              this.emit('error');
              cb(connectError);
            }
          }
          const client = new StubClient();
          return {
            Client: function () {
              return client;
            }
          };
        });
      });

      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);

      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      const spy = jest.spyOn(provider.pool, 'destroy');

      provider.prelisten(app);
      expect(spy).toHaveBeenCalled();
      done();
    });
  });

  describe('#end()', () => {
    it('should drain all connections in the pool', async (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      const drainSpy = jest.spyOn(provider.pool, 'drain');

      provider.end();
      app.close();
      expect(drainSpy).toHaveBeenCalled();
      done();
    });

    it('should do nothing when the provider is not initialized', (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      provider.end();
      app.close();
      done();
    });
  });

  describe('#release()', () => {
    it('should release a connection back to the pool if no errors were encountered', async (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      // const releaseSpy = sinon.spy(provider.pool, 'release');
      const releaseSpy = jest.spyOn(provider.pool, 'release');
      const conn = await provider.getTransactionConnection();
      provider.release(conn);
      expect(releaseSpy).toHaveBeenCalled();
      app.close();
      done();
    });

    it('should remove a connection from the pool permanently if fatal errors were encountered', async (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      // const destroySpy = sinon.spy(provider.pool, 'destroy');
      const destroySpy = jest.spyOn(provider.pool, 'destroy');
      const conn = await provider.getTransactionConnection();
      const err = new Error();
      err.fatal = true;
      provider.release(conn, err);
      expect(destroySpy).toHaveBeenCalled();
      app.close();
      done();
    });
  });

  describe('#getTransactionConnection()', () => {
    it('should resolve with a connection', async (done) => {
      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      const c = await provider.getTransactionConnection();
      expect(c).toHaveProperty('query');
      expect(c.query).toBeInstanceOf(Function);
      provider.release(c);
      provider.end();
      app.close();
      done();
    });

    it('should reject when a connection cannot be obtained', async (done) => {
      const connectError = new Error();
      const pg = require('pg'); // eslint-disable-line no-unused-vars
      jest.mock('pg', (connectError) => {
        return jest.fn().mockImplementation(() => {
          const mockedPg = {
            Client: function (opts) {
              // empty
            }
          };
          mockedPg.Client.prototype.connect = function (cb) {
            cb(connectError);
          };

          return mockedPg;
        });
      });

      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      app.set('postgresql options', {
        user: 'ravel',
        password: 'password',
        port: 15432
      });
      await app.init();

      provider.prelisten(app);
      await expect(provider.getTransactionConnection()).rejects.toEqual(connectError);// .to.be.rejectedWith(connectError).then(() => app.close());
      app.close();
      done();
    });

    it('should reject when a transaction cannot be opened', async (done) => {
      const beginTransactionError = new Error();
      const EventEmitter = require('events').EventEmitter;
      const conn = new EventEmitter();
      conn.connect = (cb) => cb();
      conn.begin = (cb) => cb(beginTransactionError);
      const pg = require('pg'); // eslint-disable-line no-unused-vars
      jest.mock('pg', (conn) => {
        return jest.fn().mockImplementation(() => {
          const mockedPg = {
            createConnection: () => conn
          };

          return mockedPg;
        });
      });

      // const EventEmitter = require('events').EventEmitter;
      // const conn = new EventEmitter();
      // const postgresql = {
      //   createConnection: () => conn
      // };
      // mockery.registerMock('postgresql', postgresql);

      const provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      provider.pool = {
        acquire: (cb) => cb(null, conn),
        drain: function (cb) { cb(); },
        destroyAllNow: function () {}
      };

      await expect(provider.getTransactionConnection()).rejects.toEqual(beginTransactionError);
      done();
    });
  });

  describe('#exitTransaction()', () => {
    var provider, connection;

    beforeEach((done) => {
      connection = {
        commit: (cb) => cb(),
        rollback: (cb) => cb()
      };
      provider = new (require('../../lib/ravel-postgresql-provider'))(app);
      provider.pool = {
        destroy: function () {},
        release: function () {},
        drain: function (cb) { cb(); },
        destroyAllNow: function () {}
      };
      done();
    });

    it('should call commit on the connection, release it and resolve when shouldCommit is true', async (done) => {
      const commitSpy = jest.spyOn(connection, 'commit');
      const releaseSpy = jest.spyOn(provider.pool, 'release');

      await provider.exitTransaction(connection, true);

      expect(commitSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      done();
    });

    it('should call commit on the connection, release it and reject when shouldCommit is true and a commit error occurred. should attempt to rollback.', async (done) => {
      const commitErr = new Error();
      const commit = (cb) => cb(commitErr);
      connection.commit = commit;
      const commitSpy = jest.spyOn(connection, 'commit');
      const rollbackSpy = jest.spyOn(connection, 'rollback');
      const releaseSpy = jest.spyOn(provider.pool, 'release');

      expect(provider.exitTransaction(connection, true)).rejects.toEqual(commitErr);
      expect(commitSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      expect(rollbackSpy).toHaveBeenCalled();
      done();
    });

    it('should call commit on the connection, release it and reject with a rollback error when shouldCommit is true and a commit error occurred, followed by a rollback error.', async (done) => {
      const commitErr = new Error();
      const commit = (cb) => cb(commitErr);
      connection.commit = commit;
      const commitSpy = jest.spyOn(connection, 'commit');
      // commitSpy.callsArgWith(0, commitErr);
      const rollbackErr = new Error();
      const rollback = (cb) => cb(rollbackErr);
      connection.rollback = rollback;
      const rollbackSpy = jest.spyOn(connection, 'rollback');
      // rollbackSpy.callsArgWith(0, rollbackErr);
      const releaseSpy = jest.spyOn(provider.pool, 'release');

      expect(provider.exitTransaction(connection, true)).rejects.toEqual(rollbackErr);
      expect(commitSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      expect(rollbackSpy).toHaveBeenCalled();
      done();
    });

    it('should call commit on the connection, destroy it and reject when shouldCommit is true and a fatal commit error occurred', async () => {
      const fatalErr = new Error();
      fatalErr.fatal = true;
      const commit = (cb) => cb(fatalErr);
      connection.commit = commit;
      const commitSpy = jest.spyOn(connection, 'commit');// sinon.stub(connection, 'commit');
      // commitStub.callsArgWith(0, fatalErr);
      const destroySpy = jest.spyOn(provider.pool, 'destroy');

      await expect(provider.exitTransaction(connection, true)).rejects.toEqual(fatalErr); // to.be.rejectedWith(fatalErr),
      expect(commitSpy).toHaveBeenCalled();
      expect(destroySpy).toHaveBeenCalled();
    });

    it('should call rollback on the connection, release it and resolve when shouldCommit is false', async (done) => {
      const rollbackSpy = jest.spyOn(connection, 'rollback');
      // const rollbackStub = sinon.stub(connection, 'rollback');
      // rollbackStub.callsArg(0);
      const releaseSpy = jest.spyOn(provider.pool, 'release');

      await expect(provider.exitTransaction(connection, false)).resolves;
      expect(rollbackSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      done();
    });

    it('should call rollback on the connection, release it and reject when shouldCommit is false and a rollback error occurred', async (done) => {
      const rollbackErr = new Error();
      const rollback = (cb) => cb(rollbackErr);
      connection.rollback = rollback;
      const rollbackSpy = jest.spyOn(connection, 'rollback');
      const releaseSpy = jest.spyOn(provider.pool, 'release');

      await expect(provider.exitTransaction(connection, false)).rejects.toEqual(rollbackErr);// .to.be.rejectedWith(rollbackErr),
      expect(rollbackSpy).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalled();
      done();
    });

    it('should call rollback on the connection, destroy it and reject when shouldCommit is false and a fatal rollback error occurred', async (done) => {
      const fatalErr = new Error();
      fatalErr.fatal = true;
      const rollback = (cb) => cb(fatalErr);
      connection.rollback = rollback;
      const rollbackSpy = jest.spyOn(connection, 'rollback');
      const destroySpy = jest.spyOn(provider.pool, 'destroy');

      await expect(provider.exitTransaction(connection, false)).rejects.toEqual(fatalErr);
      expect(rollbackSpy).toHaveBeenCalled();
      expect(destroySpy).toHaveBeenCalled();
      done();
    });
  });
});
