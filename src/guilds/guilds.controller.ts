import { Controller, Get, Post, Body, Patch, Param, Delete, ValidationPipe, UploadedFile, UseInterceptors, Headers, Res, Put } from '@nestjs/common';
import { GuildsService } from './guilds.service';
import { CreateGuildDto } from './dto/create-guild.dto';
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { GrpcMethod } from "@nestjs/microservices";
import { UpdateRoleDTO } from "./dto/update-role.dto";
import { AssignRoleDTO } from "./dto/assign-role.dto";
import { CheckPermissionDTO } from "../channels/dto/check-permission.dto";
import { CheckPermissionResponseDTO } from "../channels/dto/check-permission-response.dto";
import { UpdateMemberDTO } from "./dto/update-member.dto";
import { dot } from "node:test/reporters";
import { UpdateGuildDTO } from "./dto/update-guild.dto";
import { DeleteRoleDTO } from "./dto/delete-role.dto";

@Controller('guilds')
export class GuildsController {
  constructor(private readonly guildsService: GuildsService) { }

  @Post()
  @UseInterceptors(FileInterceptor('icon'))
  async create(@Headers('X-User-Id') userId: string, @UploadedFile() file: Express.Multer.File, @Body(new ValidationPipe({ transform: true })) dto: CreateGuildDto, @Res() res: Response) {
    dto.iconImage = file;
    const result = await this.guildsService.create(userId, dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Get()
  async findAll(@Headers('X-User-Id') userId: string, @Res() res: Response) {
    const result = await this.guildsService.findAll(userId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @GrpcMethod('GuildsService', 'FindAll')
  async findAllGrpc({ userId }: { userId: string }) {
    return await this.guildsService.findAll(userId);
  }

  @Get(':id')
  async getDetail(@Headers('X-User-Id') userId: string, @Param('id') guildId: string, @Res() res: Response) {
    const result = await this.guildsService.findOne(userId, guildId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Patch(':id')
  async updateGuild(@Headers('X-User-Id') userId: string, @Param('id') guildId: string, @Res() res: Response, @Body(new ValidationPipe({transform: true})) dto: UpdateGuildDTO) {
    dto.userId = userId;
    dto.guildId = guildId;
    
    const result = await this.guildsService.update(dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Post(':guildId/leave')
  async leaveGuild(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Res() res: Response) {
    const result = await this.guildsService.leaveGuild(userId, guildId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Post(':guildId/roles')
  async createRole(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Res() res: Response) {

    const result = await this.guildsService.createRole(userId, guildId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Patch(':guildId/roles/:roleId')
  async updateRole(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Param('roleId') roleId: string, @Body(new ValidationPipe({ transform: true })) dto: UpdateRoleDTO, @Res() res: Response) {
    dto.guildId = guildId;
    dto.id = roleId;
    dto.userId = userId;
    const result = await this.guildsService.updateRole(dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Patch(':guildId/roles/:roleId/members')
  async assignRole(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Param('roleId') roleId: string, @Body(new ValidationPipe({ transform: true })) dto: AssignRoleDTO, @Res() res: Response) {
    dto.guildId = guildId;
    dto.roleId = roleId;
    dto.assignerId = userId;
    const result = await this.guildsService.assignRole(dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Patch(':guildId/members/:memberId')
  async updateMember(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Param('memberId') memberId: string, @Body(new ValidationPipe({ transform: true })) dto: UpdateMemberDTO, @Res() res: Response) {
    dto.userId = userId;
    dto.memberId = memberId;
    dto.guildId = guildId;

    const result = await this.guildsService.updateMember(dto);
    const { status } = result;

    return res.status(status).json(result);

  }

  @GrpcMethod('GuildsService', 'CheckPermission')
  async checkPermission(dto: CheckPermissionDTO): Promise<CheckPermissionResponseDTO> {
    return { allowed: await this.guildsService.checkPermission(dto) };
  }

  @Get(':guildId/invites')
  async getGuildInvites(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Res() res: Response) {
    const result = await this.guildsService.getGuildInvites(userId, guildId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Delete(':guildId/roles/:roleId')
  async deleteRole(@Headers('X-User-Id') userId: string, @Param('guildId') guildId: string, @Param('roleId') roleId: string, @Res() res: Response) {
    const dto = new DeleteRoleDTO();
    dto.guildId = guildId;
    dto.roleId = roleId;
    dto.userId = userId;
    
    const result = await this.guildsService.deleteRole(dto);
    const { status } = result;

    return res.status(status).json(result);
  }
}
