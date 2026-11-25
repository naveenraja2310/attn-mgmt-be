const { loadEnvFile } = require('node:process');
const path = require('node:path');

loadEnvFile(path.join(__dirname, '.env'));

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'student';

const client = new MongoClient(mongoUri);
let studentsCollection;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/getstudents', async (req, res) => {
  try {
    const students = await studentsCollection.find({}).toArray();
    res.send(students);
  } catch (err) {
    res.status(500).send('Failed to fetch students');
  }
});

app.post('/addstudent', async (req, res) => {
  try {
    const newStudent = req.body;
    console.log('New student:', newStudent);

    // check product is already in the collection
    const existingStudent = await studentsCollection.findOne({ studentName: newStudent.studentName });
    if (existingStudent) {
      return res.status(400).send('Student with the same name already exists');
    }

    await studentsCollection.insertOne(newStudent);
    res.send('Student added successfully');
  } catch (err) {
    res.status(500).send('Failed to add student');
  }
});

app.put('/updatestudent/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send('Invalid student id');
    }
    const updatedStudent = req.body;
    delete updatedStudent._id;
    const result = await studentsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedStudent }
    );
    if (result.matchedCount > 0) {
      res.send('Student updated successfully');
    } else {
      res.status(404).send('Student not found');
    }
  } catch (err) {
    res.status(500).send('Failed to update student');
  }
});

app.delete('/deletestudent/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send('Invalid student id');
    }
    const result = await studentsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount > 0) {
      res.send('Student deleted successfully');
    } else {
      res.status(404).send('Student not found');
    }
  } catch (err) {
    res.status(500).send('Failed to delete student');
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const totalStudents = await studentsCollection.countDocuments();
    const genderWiseCount = await studentsCollection.aggregate([
      { $group: { _id: "$gender", count: { $sum: 1 } } }
    ]).toArray();
    const deptWiseCount = await studentsCollection.aggregate([
      { $group: { _id: "$dept", count: { $sum: 1 } } }
    ]).toArray();

    res.send({ totalStudents, genderWiseCount, deptWiseCount });
  } catch (err) {
    res.status(500).send('Failed to fetch dashboard data');
  }
});

app.post("/addAttendance", async (req, res) => {
  try {
    const { date, rollNo, status } = req.body;
    if (typeof date !== 'string' || !date || !Array.isArray(rollNo) ||
        rollNo.length === 0 || rollNo.some(number => typeof number !== 'string' || !number) ||
        typeof status !== 'string' || !status) {
      return res.status(400).send('Invalid attendance data');
    }

    const studentsRollNo = [...new Set(rollNo)];
    for (const rollNo of studentsRollNo) {
      const studentExists = await studentsCollection.findOne({ rollNo });
      if (!studentExists) {
        return res.status(400).send(`Student with rollNo ${rollNo} does not exist`);
      }
    }

    const existingAttendance = await attendanceCollection.find({
      date, rollNo: { $in: studentsRollNo }
    }).toArray();
    const existingRollNos = new Set(existingAttendance.map(att => att.rollNo));
    const newAttendance = studentsRollNo
      .filter(number => !existingRollNos.has(number))
      .map(number => ({ date, rollNo: number, status }));

    await attendanceCollection.updateMany(
      { date, rollNo: { $in: studentsRollNo } },
      { $set: { status } }
    );
    if (newAttendance.length > 0) {
      await attendanceCollection.insertMany(newAttendance);
    }
    res.send('Attendance added successfully');
  } catch (err) {
    res.status(500).send('Failed to add attendance');
  }
});

app.get("/getAttendance", async (req, res) => {
  try {
    const attendance = await attendanceCollection.find().toArray();
    res.send(attendance);
  } catch (err) {
    res.status(500).send('Failed to fetch attendance');
  }
});

app.get("/getAttendanceByDate", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).send('Date is required');
    }
    const [students, attendance] = await Promise.all([
      studentsCollection.find({}).toArray(),
      attendanceCollection.find({ date }).toArray()
    ]);
    const attendanceByRollNo = new Map(
      attendance.map(record => [record.rollNo, record.status])
    );
    res.send(students.map(student => ({
      ...student,
      status: attendanceByRollNo.get(student.rollNo) || 'Absent'
    })));
  } catch (err) {
    res.status(500).send('Failed to fetch attendance by date');
  }
});

async function start() {
  await client.connect();
  const db = client.db(dbName);
  studentsCollection = db.collection('students');
  attendanceCollection = db.collection('attendance');

  console.log("Database connected successfully")

  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});