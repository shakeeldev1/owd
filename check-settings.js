// Check what's in the database
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

async function checkDatabase() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected');

    const settingsCollection = mongoose.connection.db.collection('settings');
    const allSettings = await settingsCollection.find({}).toArray();
    
    console.log('\n📋 Settings in database:');
    console.log(JSON.stringify(allSettings, null, 2));

    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDatabase();
