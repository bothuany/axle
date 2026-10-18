const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.get('/admin/users', async (req, res) => {
  res.json(await prisma.user.findMany());
});

app.post('/admin/users', async (req, res) => {
  res.json(await prisma.user.create({ data: req.body }));
});

module.exports = app;
