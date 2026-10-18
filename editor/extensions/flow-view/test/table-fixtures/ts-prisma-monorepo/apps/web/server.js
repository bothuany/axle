const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.get('/web/users', async (req, res) => {
  res.json(await prisma.user.findMany());
});

app.post('/web/users', async (req, res) => {
  res.json(await prisma.user.create({ data: req.body }));
});

module.exports = app;
