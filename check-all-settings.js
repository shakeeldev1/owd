// Check for all settings documents
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

async function checkAllSettings() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected');

    const settingsCollection = mongoose.connection.db.collection('settings');
    
    // Check how many documents exist
    const count = await settingsCollection.countDocuments({});
    console.log(`\n📊 Total settings documents: ${count}`);

    // Get ALL settings documents
    const allSettings = await settingsCollection.find({}).toArray();
    console.log(`\n📋 All settings documents:`);
    allSettings.forEach((doc, idx) => {
      console.log(`\nDocument ${idx + 1}:`);
      console.log(JSON.stringify(doc, null, 2));
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAllSettings();
