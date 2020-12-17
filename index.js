//Load required libraries
const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const AWS = require('aws-sdk');
const fs = require('fs');
const mysql2 = require('mysql2/promise');
const cors = require('cors');

//AWS configuration
const endpoint = new AWS.Endpoint('fra1.digitaloceanspaces.com');
const s3 = new AWS.S3({
    endpoint: endpoint,
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
})

//MySQL configuration
const pool = mysql2.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB_NAME || 'mystore',
    port: process.env.MYSQL_PORT || 3306,
    timezone: '+08:00',
    connectionLimit: 4
})

//SQL statements
const SQL_CREATE_USER = "insert into users (user_id, name, email, citizenship, age) values (?, ?, ?, ?, ?)"
const SQL_SEARCH_USER_BY_ID = "Select * from users where user_id = ?";
const SQL_ADD_PRODUCT = "Insert into products (name, quantity, price, image, user_id) values (?, ?, ?, ?, ?)"

//Express server config
const app = express();
app.use(morgan('combined'));

const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000

//Start app
const p0 = new Promise((resolve,reject) => {

    if(!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_ACCESS_KEY){
        reject("Incorrect s3 cedentials")
    }
    else{
        resolve()
    }

})

const p1 = pool.getConnection();

Promise.all([p0,p1]).then(async result => {

    const conn = result[1];
    await conn.ping();
    console.log(">>> Pinging database...")
    app.listen(PORT, () => {console.log(`Your app started on port ${PORT} at ${new Date()}`)});
    conn.release()

}).catch(e => {console.log("Unable to start app.", e)})


//Convert to promises
const readFile = (path) => new Promise((resolve,reject) => {

    fs.readFile(path, (err, buffer) => {

        if(err == null){
            console.log("readFile resolved")
            resolve(buffer)
        }
        else{
            console.log("readFile rejected")
            reject(err)
        }

    })

})

const putImage = (file, buffer) => new Promise((resolve, reject) => {

    const params = {
        Bucket: 'chins',
        Key: file.filename,
        Body: buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
        ACL: "public-read"
    }

    s3.putObject(params, (err, result) => {

        if(err == null) {
            resolve(result)
        }
        else{
            reject(err)
        }

    })

})

    
   



//Routes

//Sign up 
app.use(express.urlencoded({extended:true}));
app.use(cors())

app.post('/signup', async(req, res) => {

    const rb = req.body;
    console.log(rb)
    const conn = await pool.getConnection();
    try{
        const [user,_] = await conn.query(SQL_SEARCH_USER_BY_ID, [rb.user_id])
        if(user.length == 0){
            const [result,_] = await conn.query(SQL_CREATE_USER, [rb.user_id, rb.name, rb.email, rb.citizenship, rb.age]);
            res.status(200).type('application/json').json({result})
        }
        else{
            res.status(200).type('application/json').json({"message": "user exists. Please proceed to log in."})
        }
        
    }
    catch(e){
        res.status(500).type('application/json').json({e})
    }
    finally{
        conn.release();
    }

})

//Login 
app.get('/login/:user_id', async (req,res) => {

    const user_id = req.params['user_id'];
    const conn = await pool.getConnection();
    try{
        const [user,_] = await conn.query(SQL_SEARCH_USER_BY_ID, [user_id]);
        if(!user.length){
            res.status(200).type('application/json').json({"message": "User does not exist. Please proceed to sign up."})
        }
        else{
            res.status(200).type('application/json').json({"message": "Login successful."})
        }
    }
    catch(e) {
        res.status(500).type('application/json').json({e});
    }
    finally{
        conn.release()
    }

})


//Post new product 
let multipart = multer({dest: `${__dirname}/tmp/uploads`})
app.post('/upload/:user_id', multipart.single("image"), async (req, res) => {

    console.log(req.file);
    console.log(req.body);
    const user_id = req.params['user_id'];
    const rb = req.body;
    const conn = await pool.getConnection();
    try{
        await conn.beginTransaction();
        const [sqlResult, _] = await conn.query(SQL_ADD_PRODUCT, [rb.name, rb.quantity, rb.price, `https://chins.fra1.digitaloceanspaces.com/${req.file.filename}`, user_id])
        const buffer = await readFile(req.file.path);
        const result = await putImage(req.file, buffer);
        await conn.commit()
        res.status(200).type('application/json').json({"message": "Upload successful."})
    }
    catch(e){
        conn.rollback()
        res.status(500).type('application/json').json({"message": "Upload unsuccessful.", e: e.message})
    }
    finally{
        fs.unlink(req.file.path, ()=>{});
        conn.release()
    }

})