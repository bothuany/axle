const express = require('express');
const { getOrders } = require('./orders');
const app = express();
const router = express.Router();
router.get('/orders', getOrders);
app.use('/api', router);
app.post('/ping', (req, res) => res.send('pong'));
