import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AVATAR_IDS } from '../domain/model/types';

/** DTOs de entrada da API. Tudo validado pelo ValidationPipe global (whitelist + forbidNonWhitelisted). */

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
export const UID_RE = /^[\w-]{4,128}$/;
export const E164_RE = /^\+[1-9]\d{6,14}$/;

export class RoomCodeParam {
  @ApiProperty({ example: 'ABC234' })
  @Transform(upper)
  @Matches(ROOM_CODE_RE, { message: 'Código inválido.' })
  code!: string;
}

export class UidParam {
  @ApiProperty()
  @Matches(UID_RE, { message: 'uid inválido.' })
  uid!: string;
}

export class IdParam {
  @ApiProperty()
  @Matches(/^[0-9a-f-]{36}$/i, { message: 'id inválido.' })
  id!: string;
}

export class DeviceDto {
  @ApiProperty() @IsString() @Length(10, 4096) token!: string;
  @ApiProperty({ example: 'android' }) @IsString() @Length(1, 20) platform!: string;
}

export class RemoveDeviceDto {
  @ApiProperty() @IsString() @Length(10, 4096) token!: string;
}

export class BootstrapDto {
  @ApiPropertyOptional({ type: DeviceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

export class UpdateProfileDto {
  @ApiProperty({ example: 'Zé do Truco' }) @IsString() @Length(1, 40) nickname!: string;
  @ApiProperty({ enum: AVATAR_IDS }) @IsIn(AVATAR_IDS) avatarId!: string;
}

export class SearchQuery {
  @ApiProperty() @IsString() @Length(1, 40) term!: string;
}

export class PageQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) cursor?: string;
}

export class ContactsSyncDto {
  @ApiProperty({ type: [String], example: ['+5531999990000'] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(E164_RE, { each: true, message: 'Telefone inválido.' })
  phones!: string[];
}

export class FriendRequestDto {
  @ApiProperty() @Matches(UID_RE) toUid!: string;
}

export class RespondDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
}

export class BlockDto {
  @ApiProperty() @Matches(UID_RE) targetUid!: string;
}

export class InviteTokenDto {
  @ApiProperty() @IsString() @Length(16, 64) @Matches(/^[\w-]+$/) token!: string;
}

export class PresenceQueryDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(UID_RE, { each: true })
  uids!: string[];
}

export class FriendRoomDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Matches(UID_RE, { each: true })
  friendUids!: string[];
}

export class ReadyDto {
  @ApiProperty() @IsBoolean() ready!: boolean;
}

export class RoomInviteDto {
  @ApiProperty() @Matches(UID_RE) friendUid!: string;
}

export class DirectInviteDto {
  @ApiProperty() @Matches(UID_RE) friendUid!: string;
  @ApiPropertyOptional({ type: [String], description: 'Telefones do contato (prova de vínculo, não gravados).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(E164_RE, { each: true })
  phones?: string[];
}

export class MatchmakingDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowBots?: boolean;
}

export class GameActionBody {
  @ApiProperty({ example: 'PLAY_CARD' }) @IsString() @MaxLength(32) type!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(3) seat!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3) cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['high', 'middle', 'low']) depth?: string;
}

export class SubmitActionDto {
  @ApiProperty({ type: GameActionBody })
  @IsObject()
  @ValidateNested()
  @Type(() => GameActionBody)
  action!: GameActionBody;

  @ApiProperty({ description: 'Chave de idempotência da ação (actionId).' })
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  actionId!: string;
}

export class FinalizeAiMatchDto {
  @ApiProperty() @IsString() @Length(4, 80) matchId!: string;
  @ApiProperty() @IsNumber() seed!: number;
  @ApiProperty() @IsNumber() aiSeed!: number;
  @ApiProperty({ enum: ['easy', 'normal', 'hard'] }) @IsIn(['easy', 'normal', 'hard']) difficulty!: 'easy' | 'normal' | 'hard';
  @ApiProperty({ type: [GameActionBody] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => GameActionBody)
  actions!: GameActionBody[];
}

export class RankingQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AdminWeekQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-W\d{2}$/) weekKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(24) leagueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(48) groupId?: string;
}
