import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { AdminGuard } from './admin.guard';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Global()
@Module({
  providers: [FirebaseAdminService, AuthService, AdminGuard, FirebaseAuthGuard],
  exports: [FirebaseAdminService, AuthService, AdminGuard, FirebaseAuthGuard],
})
export class AuthModule {}
