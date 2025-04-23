const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const API_URL = 'http://localhost:3000/api/admin';
const AUTH_URL = 'http://localhost:3000/api/auth';
let authToken = '';

// Test admin credentials
const adminCredentials = {
  username: 'admin1',
  password: 'admin123',
};

// Test instructor data
const testInstructor = {
  username: 'testinstructor',
  password: 'test123',
  email: 'test@instructor.com',
  firstName: 'Test',
  lastName: 'Instructor',
  department: 'Computer Science',
};

const testAdmin = async () => {
  try {
    console.log('Starting admin functionality tests...\n');

    // Step 1: Register a new instructor
    console.log('1. Testing instructor registration...');
    const registerResponse = await axios.post(
      `${AUTH_URL}/register/instructor`,
      testInstructor
    );
    console.log('✓ Instructor registration successful\n');

    // Step 2: Login as admin
    console.log('2. Testing admin login...');
    const loginResponse = await axios.post(
      `${AUTH_URL}/login`,
      adminCredentials
    );
    authToken = loginResponse.data.token;
    console.log('✓ Admin login successful\n');

    // Configure axios for subsequent requests
    const config = {
      headers: { Authorization: `Bearer ${authToken}` },
    };

    // Step 3: Get dashboard statistics
    console.log('3. Testing dashboard statistics...');
    const dashboardResponse = await axios.get(`${API_URL}/dashboard`, config);
    console.log('Dashboard stats:', dashboardResponse.data.data);
    console.log('✓ Dashboard statistics retrieved\n');

    // Step 4: Get all instructors
    console.log('4. Testing get all instructors...');
    const instructorsResponse = await axios.get(
      `${API_URL}/instructors`,
      config
    );
    console.log('Total instructors:', instructorsResponse.data.data.length);
    console.log('✓ Instructors list retrieved\n');

    // Step 5: Get pending instructors
    console.log('5. Testing get pending instructors...');
    const pendingResponse = await axios.get(
      `${API_URL}/instructors/pending`,
      config
    );
    console.log('Pending instructors:', pendingResponse.data.data.length);
    console.log('✓ Pending instructors list retrieved\n');

    // Step 6: Approve an instructor (if any pending)
    if (pendingResponse.data.data.length > 0) {
      const instructorToApprove = pendingResponse.data.data[0];
      console.log('6. Testing instructor approval...');
      const approveResponse = await axios.put(
        `${API_URL}/instructors/${instructorToApprove.user_id}/approve`,
        {},
        config
      );
      console.log('✓ Instructor approved successfully\n');
    }

    console.log('All admin tests completed successfully! ✓');
  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
  }
};

// Run the tests
testAdmin();
