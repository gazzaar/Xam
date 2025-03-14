const { Router } = require('express');
const indexRouter = Router();
indexRouter.get('/', (req, res) => {
  res.send('Focus please and study hard');
  res.end();
});

module.exports = indexRouter;
