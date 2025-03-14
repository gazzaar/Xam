const express = require('express');
const indexRouter = require('./routes/index.js');
const studentsRouter = require('./routes/studentsRoutes.js');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', indexRouter);
app.use('/students', studentsRouter);

app.listen(3000);
