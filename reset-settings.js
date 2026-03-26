// Clean slate: delete and recreate settings with correct values
const mongoose = require('mongoose');

const mongoUri = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

async function resetSettings() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected');

    const settingsCollection = mongoose.connection.db.collection('settings');
    
    // Show what's currently there
    console.log('\n📋 Current settings:');
    const current = await settingsCollection.findOne({});
    console.log(JSON.stringify(current, null, 2));

    // Delete ALL settings documents
    console.log('\n🗑️  Deleting all settings documents...');
    const deleteResult = await settingsCollection.deleteMany({});
    console.log(`Deleted ${deleteResult.deletedCount} documents`);

    // Create fresh settings with correct values
    const newSettings = {
      whatsappEnabled: true,
      whatsappNumber: '97471378000',  // NO plus sign
      language: 'en',
      storeName: 'Oud Al Zubarah',
      storeEmail: 'info@oudalzubarah.qa',
      storePhone: '+974 4444 5555',
      storeAddress: 'Pearl, Doha, Qatar',
      storeHours: 'Saturday - Thursday: 10AM - 10PM',
      currency: 'QAR',
      emailNotifications: true,
      orderNotifications: true,
      stockAlerts: true,
      marketingEmails: false,
      twoFactorAuth: false,
      sessionTimeout: '30',
      creditCardEnabled: true,
      applePayEnabled: true,
      bankTransferEnabled: true,
      cashOnDeliveryEnabled: true,
      skipCashEnabled: true,
      freeShippingThreshold: '200',
      standardShippingFee: '25',
    };

    console.log('\n✨ Creating fresh settings...');
    const insertResult = await settingsCollection.insertOne(newSettings);
    console.log('Inserted ID:', insertResult.insertedId);

    // Verify
    console.log('\n✅ Verification:');
    const result = await settingsCollection.findOne({});
    console.log(JSON.stringify(result, null, 2));

    await mongoose.connection.close();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetSettings();
