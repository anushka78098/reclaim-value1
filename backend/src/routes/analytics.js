const express = require('express');
const { authenticate } = require('../middleware');
const { summaryFor } = require('../lib/impact');
const { dashboardFor, impactRecordsFor } = require('../lib/dashboard');

const router = express.Router();
router.use(authenticate);

// Every answer is built from the signed-in account (JWT), so a seller only ever
// sees their own numbers, a buyer theirs, and only an admin sees the platform.
router.get('/summary', async (req, res) => res.json(await summaryFor(req.user)));
router.get('/dashboard', async (req, res) => res.json(await dashboardFor(req.user)));
router.get('/impact-records', async (req, res) => res.json(await impactRecordsFor(req.user)));

module.exports = router;
