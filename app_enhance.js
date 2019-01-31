require('dotenv').config();

// variables
const APP_PORT = process.env.PORT || 8080;
const CACHE_TIME = 3600;

// logger
const winston = require('winston');
const logger = winston.createLogger({
  level: 'verbose',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
  ]
});

// mercator
const SphericalMercator = require('@mapbox/sphericalmercator');
const mercator = new SphericalMercator({size: 256});

// database library
const {Client} = require('pg')
const db = new Client();
db.connect();

// cache
const bluebird = require('bluebird');
const redis = bluebird.promisifyAll(require('redis'));
const cache = redis.createClient();

// http server
const express = require('express');
const app = express();

// add some middlewares
app.use(require('compression')());
app.use(require('cors')());
app.use(require('morgan')('dev'));

app.use(express.static(__dirname + '/public'));

// route
const layerName = 'pune_roads';
app.get(`/tiles/${layerName}/:z/:x/:y.mvt`, async (req, res) => {
  const {z, x, y} = req.params;
  const cacheKey = `${layerName}_${z}_${x}_${y}`;
  try {
    const cachedTileStr = await cache.getAsync(cacheKey);
    if (cachedTileStr) {
      const cachedTile = Buffer.from(cachedTileStr, 'hex');
      if (cachedTile.length === 0) {
        res.status(204);
      }
      res.send(cachedTile);
      return;
    }
  } catch (err) {
    logger.error(err.toString());
  }

  const bbox = mercator.bbox(x, y, z, false);
  const query = `
      SELECT ST_AsMVT(q, '${layerName}', 4096, 'geom') FROM (
        SELECT 
          id, name, highway,
          ST_AsMVTGeom(
            wkb_geometry,
            ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326),
            4096,
            256,
            true
          ) geom FROM pune_roads WHERE highway IS NOT NULL
        ) q
    `;
  try {
    const tiles = await db.query(query);
    const tile = tiles.rows[0];
    res.setHeader('Content-Type', 'application/x-protobuf');
    cache.set(cacheKey, tile.st_asmvt.toString('hex'), 'EX', CACHE_TIME);
    if (tile.st_asmvt.length === 0) {
      res.status(204);
    }
    res.send(tile.st_asmvt);
  } catch (err) {
    logger.error(err);
    res.status(404).send({ error: err.toString() });
  }
});

app.listen(APP_PORT, () => {
  logger.info(`Listening on ${APP_PORT}`);
});