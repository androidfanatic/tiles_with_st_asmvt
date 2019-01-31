// mercator
const SphericalMercator = require('@mapbox/sphericalmercator');
const mercator = new SphericalMercator({size: 256});

// database library
const {Client} = require('pg')
const db = new Client('postgres://postgres:pass@localhost:5432/roads');
db.connect();

// http server
const express = require('express');
const app = express();

app.use(express.static(__dirname + '/public'));

// route
const layerName = 'pune_roads';
app.get(`/tiles/${layerName}/:z/:x/:y.mvt`, async (req, res) => {
  const bbox = mercator.bbox(req.params.x, req.params.y, req.params.z, false);
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
    if (tile.st_asmvt.length === 0) {
      res.status(204);
    }
    res.send(tile.st_asmvt);
  } catch (err) {
    res.status(404).send({ error: err.toString() });
  }
});

app.listen(8080);