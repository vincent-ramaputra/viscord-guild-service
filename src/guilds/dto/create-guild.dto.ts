import {AutoMap} from "@automapper/classes"
export class CreateGuildDto {
    @AutoMap()
    name: string;

    @AutoMap()
    iconImage: Express.Multer.File;
}