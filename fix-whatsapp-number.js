// Force update the whatsApp number to correct value
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

async function fixWhatsAppNumber() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected');

    const settingsCollection = mongoose.connection.db.collection('settings');
    
    // First, show what's currently there
    console.log('\n📋 Current settings in database:');
    const current = await settingsCollection.findOne({});
    console.log(JSON.stringify(current, null, 2));

    // Update: Remove the + sign and use only digits
    const newNumber = '97471378000';
    
    console.log(`\n🔄 Updating whatsappNumber to: ${newNumber}`);
    const result = await settingsCollection.updateOne(
      {},
      { $set: { whatsappNumber: newNumber } },
      { upsert: true }
    );

    console.log('Update result:', result);

    // Verify the update
    const updated = await settingsCollection.findOne({});
    console.log('\n✅ Updated settings:');
    console.log(JSON.stringify(updated, null, 2));

    await mongoose.connection.close();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixWhatsAppNumber();
