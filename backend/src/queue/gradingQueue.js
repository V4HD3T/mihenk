const { Queue } = require('bullmq');
const createConnection = require('./redis');

const gradingQueue = new Queue('grading', { connection: createConnection() });

module.exports = gradingQueue;
