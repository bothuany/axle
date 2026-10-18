const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.get('/orders', async (req, res) => {
  res.json(await prisma.order.findMany({ where: { status: 'open' } }));
});

app.post('/orders', async (req, res) => {
  res.json(await prisma.order.create({ data: req.body }));
});

module.exports = app;
