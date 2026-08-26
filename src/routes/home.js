import express from 'express';
import { requireAuth } from '../middleware/auth.js';

export function homeRouter() {
  const router = express.Router();

  router.get('/', requireAuth(), (req, res) => {
    res.render('home', { username: req.currentUser.username });
  });

  return router;
}
