/* eslint-disable @typescript-eslint/no-require-imports */
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MONGODB_URI = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';
const PICS_FOLDER = path.join(__dirname, '..', '..', 'pics');

// Product schema
const ProductSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.model('Product', ProductSchema, 'products');

// Map image filenames to product names (Arabic names from pics folder)
const imageNameMapping = {
  'بنغالي اندر وتر.jpg.jpeg': 'Bengali Under Water',
  'بوتان.jpg.jpeg': 'Bhutan Premium',
  'بورمي ماتشينا.jpg.jpeg': 'Burmese Machina',
  'بورمي.jpg.jpeg': 'Burmese Premium',
  'بوكس 1.jpg.jpeg': 'Gift Box Premium',
  'بوكس 2.jpg.jpeg': 'Gift Box Classic',
  'بوكس 3.jpg.jpeg': 'Gift Box Essential',
  'بونتيانك شخصي.jpg.jpeg': 'Malaysian Personal',
  'بونتيانك فاخر.jpg.jpeg': 'Cambodian Premium',
  'بونتيانك يومي.jpg.jpeg': 'Malaysian Personal',
  'تراد.jpg.jpeg': 'Laotian Standard',
  'ترينجانو.jpg.jpeg': 'Trini Gano',
  'توزيع.jpg.jpeg': 'Wholesale Package',
  'توزيع.jpg2.jpg.jpeg': 'Wholesale Package',
  'جار هندي  قاروهيلز.jpg.jpeg': 'Indian Jari Hills',
  'جار هندي شخصي.jpg.jpeg': 'Indian Jari Personal',
  'جار هندي فاخر.jpg.jpeg': 'Indian Jari Royal',
  'جار هندي ملكي.jpg.jpeg': 'Indian Jari Royal',
  'جنوب تايلند.jpg.jpeg': 'South Thailand',
  'دهن عود.jpg.jpeg': 'Pure Oud Oil',
  'سقنتشر الزبارة.jpg.jpeg': 'Signature Al-Zubarah',
  'سلاني خاص .jpg.jpeg': 'Special Blend',
  'سورات.jpg.jpeg': 'Surat Premium',
  'سيلاني ادمز.jpg.jpeg': 'Silani Adams',
  'شنغماي ..jpg.jpeg': 'Singmai Premium',
  'عود بالعنبر.jpg.jpeg': 'Oud with Amber',
  'عود روبس.jpg.jpeg': 'Oud Rubis',
  'فلبيني نوادر.jpg.jpeg': 'Filipino Rare',
  'فيتنامي شرايح.jpg.jpeg': 'Vietnamese Slices',
  'فيتنامي فاخر.jpg.jpeg': 'Vietnamese Premium',
  'فيتنامي قديم.jpg.jpeg': 'Vietnamese Premium Old',
  'فيتنامي مناسبات.jpg.jpeg': 'Vietnamese Special Occasions',
  'فيتنامي.jpg.jpeg': 'Vietnamese Standard',
  'كاوياي ملكي.jpg.jpeg': 'Kawayi Royal',
  'كلمنتان الذهب.jpg.jpeg': 'Kalamantan Al Zahab',
  'كلمنتان خاص.jpg.jpeg': 'Cambodian Special',
  'كلمنتان فاخر.jpg.jpeg': 'Kalamantan Fakhir',
  'كلمنتان موري.jpg.jpeg': 'Kalamantan Mori',
  'كمبودي الزبارة.jpg.jpeg': 'Malaysian Al-Zubarah',
  'كمبودي النخبة.jpg.jpeg': 'Cambodian Elite',
  'كمبودي خاص.jpg.jpeg': 'Cambodian Special',
  'كوشان.jpg.jpeg': 'Khoshan Personal',
  'لاوسي قديم دهن.jpg.jpeg': 'Laotian Old Oud Oil',
  'لاوسي قديم.jpg.jpeg': 'Laotian Old',
  'لاوسي.jpg.jpeg': 'Laotian Standard',
  'ماليزي vip.jpg.jpeg': 'Malaysian VIP',
  'ماليزي الزبارة.jpg.jpeg': 'Malaysian Al-Zubarah',
  'ماليزي اندر وتر.jpg.jpeg': 'Malaysian Under Water',
  'ماليزي خاص.jpg.jpeg': 'Malaysian Special',
  'ماليزي شخصي.jpg.jpeg': 'Malaysian Personal',
  'ماليزي فاخر قديم.jpg.jpeg': 'Malaysian Premium Aged',
  'ماليزي قديم ثقيل.jpg.jpeg': 'Malaysian Old Heavy',
  'ماليزي مناسبات.jpg.jpeg': 'Malaysian Special Occasions',
  'ماليزي نوادر.jpg.jpeg': 'Malaysian Rare',
  'ماليزي.jpg.jpeg': 'Malaysian Standard',
  'مالينو الزبارة.jpg.jpeg': 'Malino Al-Zubarah',
  'مالينو خاص.jpg.jpeg': 'Malino Special',
  'مالينو شخصي .jpg.jpeg': 'Malino Personal',
  'مالينو فاخر.jpg.jpeg': 'Malino Premium',
  'مالينو قديم.jpg.jpeg': 'Malino Old',
  'مبخرة الزرقاء 2.jpg.jpeg': 'Blue Incense Burner',
  'مبخرة الزرقاء.jpg.jpeg': 'Blue Incense Burner',
  'مبخرة خضرا.jpg.jpeg': 'Green Incense Burner',
  'مبخرة سودة.jpg.jpeg': 'Black Incense Burner',
  'مسك.jpg.jpeg': 'Musk Premium',
  'معدل copy.jpg.jpeg': 'Special Blend',
  'موروركي vip.jpg.jpeg': 'Moroki VIP',
  'موروكي  الذهب.jpg.jpeg': 'Moroki Gold',
  'موروكي الزبارة.jpg.jpeg': 'Moroki Al-Zubarah',
  'موروكي بلس.jpg.jpeg': 'Moroki Plus',
  'موروكي بليت.jpg.jpeg': 'Moroki Plate',
  'موروكي مناسبات.jpg.jpeg': 'Moroki Special Occasions',
  'موروكي.jpg.jpeg': 'Moroki Standard',
  'موناكو.jpg.jpeg': 'Monaco Premium',
  'هندي  موري جامبو.jpg.jpeg': 'Indian Mori Jumbo',
  'هندي اميري.jpg.jpeg': 'Indian Amiri',
  'هندي خاص.jpg.jpeg': 'Indian Special',
  'هندي سلطاني.jpg.jpeg': 'Indian Sultani',
  'هندي سيوفي بلاك.jpg.jpeg': 'Indian Syofi Black',
  'هندي شخصي .jpg.jpeg': 'Indian Personal',
};

async function uploadImages() {
  let conn;
  
  try {
    console.log('=== Starting Image Upload to Cloudinary ===\n');

    // Connect to database
    console.log('Connecting to database...');
    conn = await mongoose.connect(MONGODB_URI);
    console.log('Connected to database\n');

    // Get all products from database
    const products = await Product.find({});
    console.log(`Found ${products.length} products in database\n`);

    // Get all files in pics folder
    const files = fs.readdirSync(PICS_FOLDER).filter(f => 
      f.endsWith('.jpg.jpeg') || f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png')
    );
    console.log(`Found ${files.length} images in pics folder\n`);

    let uploaded = 0;
    let updated = 0;
    let errors = 0;

    // Process each image
    for (const filename of files) {
      const productName = imageNameMapping[filename];
      if (!productName) {
        console.log(`⚠️ No mapping found for: ${filename}`);
        continue;
      }

      // Find matching product
      const product = products.find(p => 
        p.name === productName || 
        p.nameAr === productName ||
        p.slug === productName.toLowerCase().replace(/\s+/g, '-')
      );

      if (!product) {
        console.log(`⚠️ No product found for: ${productName}`);
        continue;
      }

      const filePath = path.join(PICS_FOLDER, filename);
      
      try {
        console.log(`Uploading: ${filename} -> ${product.name || product.nameAr}...`);
        
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(filePath, {
          folder: 'oud-products',
          resource_type: 'image',
          use_filename: true,
          unique_filename: true,
        });

        console.log(`  ✓ Uploaded: ${result.secure_url}`);

        // Update product in database
        await Product.updateOne(
          { _id: product._id },
          { 
            $set: { 
              image: result.secure_url,
              images: [result.secure_url]
            }
          }
        );

        console.log(`  ✓ Updated database`);
        updated++;
        uploaded++;
      } catch (err) {
        console.log(`  ✗ Error: ${err.message}`);
        errors++;
      }
    }

    console.log('\n=== Upload Complete ===');
    console.log(`Images uploaded: ${uploaded}`);
    console.log(`Products updated: ${updated}`);
    console.log(`Errors: ${errors}`);

    await mongoose.disconnect();
    console.log('\nDisconnected from database');
    process.exit(0);
  } catch (error) {
    console.error('Upload failed:', error);
    if (conn) await mongoose.disconnect();
    process.exit(1);
  }
}

uploadImages();
