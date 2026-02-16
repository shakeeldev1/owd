import { Controller, Post, UseGuards, UseInterceptors, UploadedFile, UploadedFiles, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CloudinaryService } from './cloudinary.service';

const imageFileFilter = (_req: any, file: any, callback: any) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
    return callback(new BadRequestException('Only image files are allowed'), false);
  }
  callback(null, true);
};

const storage = memoryStorage();

@Controller('upload')
@UseGuards(AuthGuard('jwt'))
export class UploadController {
  constructor(private cloudinaryService: CloudinaryService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage, fileFilter: imageFileFilter, limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.cloudinaryService.uploadImage(file);
    return {
      url: result.secure_url,
      publicId: result.public_id,
      filename: result.public_id,
      originalName: file.originalname,
      size: file.size,
    };
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10, { storage, fileFilter: imageFileFilter, limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');
    const results = await this.cloudinaryService.uploadMultiple(files);
    return results.map((result, i) => ({
      url: result.secure_url,
      publicId: result.public_id,
      filename: result.public_id,
      originalName: files[i].originalname,
      size: files[i].size,
    }));
  }
}
