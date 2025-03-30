const { Storage , File : MEGAFile } = require("megajs");
const fs = require("fs");
const fsP = require("fs").promises;
const archiver = require('archiver');
const PATH = require("path")
const os = require("os")  
const AdmZip =  require("adm-zip");

// Global Varibles 
require('dotenv').config({ path: '.env' });

const USERNAME = os.userInfo().username ;
const localUserProfileName = PATH.join("C:" , "Users" , USERNAME );
// Node doesn't support top-level await when using CJS
const email =  process.env.EMAIL;
const password =  process.env.PASSWORD;

async function initializeStorage(email, password) {
    const storage = new Storage({ 
      email: email, 
      password : password, 
      userAgent: "gameSync/1.0" 
    });

    await storage.ready; // Wait for storage to be ready
      console.log("\u2705 " + storage.name + " Login successfully");
      return storage;
}

function getFileSize(path) {
  return fs.statSync(path).size; // Directly return size
}

async function uploadFile(storage, filePath, fileName , message = "") {
  try {
    const file = await storage.root.find("CloudGameSaver").upload(
      {
        name: fileName,
        size: getFileSize(filePath),
      },
      fs.createReadStream(filePath)
    ).complete;
    if (message){
      console.log(message);
    }else{
      console.log("🎮 " +file.name + " updated successfully:");
    }
    return file;
  } catch (error) {
    console.error("\u274C Upload failed:", error);
    throw error; // Re-throw to handle in caller
  }
}


async function zipFolder(sourceFolder, outputPath) {
  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } }); // Maximum compression

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      // console.log(`ZIP created: ${archive.pointer()} total bytes`);
      resolve(outputPath);
    });

    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.directory(sourceFolder, false); // Second param 'false' preserves folder structure
    archive.finalize();
  });
}
async function unzipFolder(zipPath, outputFolder) {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(outputFolder, true); // Second param: overwrite existing files
    console.log(`Extracted to ${outputFolder}`);
    return outputFolder;
  } catch (err) {
    console.error('Error while unzipping:', err);
    throw err;
  }
}
function date(){
  const date = new Date();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
};

async function downloadCloudGameSaver(storage, fileName, disPath, downloadedFileName = "") {
  return new Promise(async (resolve, reject) => {
    try {
      const cloudGameFolder = storage.root.find("CloudGameSaver");
      const targetNode = await cloudGameFolder.children.filter((item) => item.name === fileName);

      const fileUrl = await targetNode[0].link();
      const fileFromUrl = MEGAFile.fromURL(fileUrl);

      const downloadId = fileFromUrl.downloadId;
      const key = fileFromUrl.key;
      const fileFromObject = new MEGAFile({ downloadId, key });

      const outputPath = downloadedFileName
        ? PATH.join(disPath, downloadedFileName)
        : PATH.join(disPath, targetNode[0].name);

      const writeStream = fs.createWriteStream(outputPath);

      // Handle stream events to know when download is done
      fileFromObject.download()
        .pipe(writeStream)
        .on("finish", () => {
          console.log(`✅ Sync : ${outputPath}`);
          resolve(true);
        })
        .on("error", (err) => {
          console.error(`❌ Sync failed: ${err}`);
          reject(err);
        });
    } catch (err) {
      console.error(`❌ Error in downloadCloudGameSaver: ${err}`);
      reject(err);
    }
  });
}
async function syncGames(storage){
  // check if localgameRepo.json exsite
  if (fs.existsSync(PATH.join("C:" , "Users"  , USERNAME , "localgameRepo.json")) != true){
    console.log("\u26A0 localgameRepo.json not founded");
    if(await downloadCloudGameSaver(storage , "cloudgameRepo.json" , PATH.join("C:" , "Users" , USERNAME) , "localgameRepo.json")){
      console.log("\u2705 localgameRepo.json downloaded successfully!");
    }else {
      console.log("\u274C  localgameRepo.json download faild");
    }
  }

};
async function  readJsonFile(path) {
  const jsonFile =  await fsP.readFile(path, "utf-8"); 
  const jsonData =  JSON.parse(jsonFile);
  return jsonData; 
}

function deleteFile(storage, fileName) {
  return new Promise(async (resolve, reject) => {
    try {
      const cloudGameFolder = storage.root.find("CloudGameSaver");
      const targetNode = await cloudGameFolder.children.filter((item) => item.name === fileName);
      const res = await targetNode;
      res.forEach((f) => f.delete(true));
      resolve(true);
    } catch (error) {
      reject(false);
    }
  });
}
async function checkAndUploadGamesToCloud  (storage) {
  
  console.log("🔄 Start Synchrouniz Games")

  const jsonData = await readJsonFile(PATH.join("C:" , "Users" , USERNAME , "localgameRepo.json"))
  const results = await Promise.all(
    jsonData.gamesCloud.map(async (game) => {
        
        if(game.isFileUploaded == false || game.lastTimeEdit != date()){
          if(fs.existsSync(PATH.join(localUserProfileName , game.distLocal)) ==  true){
          try{
            const fileZip = await zipFolder(PATH.join(localUserProfileName , game.distLocal) , "./" + game.gameCloudName + ".zip")
            // delete the old file and upload the new one
            await deleteFile(storage , game.gameCloudName + ".zip");
            await uploadFile(storage , PATH.join("./" , game.gameCloudName +".zip"),game.gameCloudName + ".zip");
            
            game.isFileUploaded = true;
            game.lastTimeEdit = date();
            fs.rm(fileZip , (error) => {
              if(error){
                console.log(error)
              }
            }
          );
          }catch (error){
            game.isFileUploaded = false;
            console.log(error)
          }
    
        }else{
          console.log(game.gameName , "Not found the Path")
        }; 
      }
      return game;
      })
  )

  jsonData.gamesCloud =  results ;

  if(jsonData.lastTimeSync != date()){
    jsonData.lastTimeSync = date()
    // save data in local file 
    fs.writeFileSync(PATH.join(localUserProfileName , "localgameRepo.json") , JSON.stringify(jsonData))
    // update cloud file by delete the cloud file and upload the local file as cloud file 
    await deleteFile(storage,"cloudgameRepo.json");
    // upload 
    await uploadFile(storage,PATH.join(localUserProfileName , "localgameRepo.json") , "cloudgameRepo.json","\u2705 cloudgameRepo.json update successfully!") ;

  }else{
    // print a message
    console.log("🗸 No new games to upload to the cloud")
  }
}
async function checkIfGameFileExisteInComputer(storage){
  // if not download it from cloud
  const jsonData = await  readJsonFile(PATH.join(localUserProfileName , "localgameRepo.json"))
  const res = await Promise.all(
    jsonData.gamesCloud.map(async (game) => {
    if(fs.existsSync(PATH.join(localUserProfileName , game.distLocal)) ==  false){
      await downloadCloudGameSaver(storage , game.gameCloudName + ".zip" , "./");
        await unzipFolder("./" +game.gameCloudName + ".zip" , PATH.join(localUserProfileName , game.distLocal ));
        fs.promises.rm("./" +game.gameCloudName + ".zip");
      }
    })
  );

}

(async () => {
  let storage;
  try {
    storage = await initializeStorage(email, password);
    await syncGames(storage);
    await checkAndUploadGamesToCloud(storage);
    await checkIfGameFileExisteInComputer(storage);
    console.log(`✅ Finish Synchronization`);
  } catch (error) {
    console.log("\u274C Check your email and password and try again");
    console.error("Error details:", error);
  } 
})();
