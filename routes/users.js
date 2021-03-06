const router = require('express').Router();
const Joi = require('@hapi/joi');
const bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
const tokenValidate = require('../token_validate');


const User = require('../models/User').user;
const UserInfo = require('../models/User').userInfo;

//Data validate Schemas
userRegisterValidate = new Joi.object().keys({
    fname: Joi.string().min(3).max(30).required(),
    lname: Joi.string().min(3).max(30).required(),
    username: Joi.string().alphanum().min(5).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(5).max(30).required(),
    vKey: Joi.number().required()
});

userLoginValidate = new Joi.object().keys({
    usernameOrEmail: Joi.string().min(5).max(30).required(),
    password: Joi.string().min(5).max(30).required()
});


//Register
router.post('/register', async (req, res) => {

    // profile photo vars : 
    var hasProfilePhoto = false;
    var photoSaved = false;
    var fileName = '';

    //check if the user has profile photo:
    if (req.files) {
        hasProfilePhoto = true;
        const file = req.files.img;
        fileName = file.name;
        // save the photo
        await file.mv('./uploads/userImg/' + fileName, (err) => {
            //check if was an error 
            if (err) {
                res.status(400).json({ error: err });
                return;
            }
            photoSaved = true;
        });
    }

    // to validate the user data:
    const { error } = Joi.validate(req.body, userRegisterValidate);
    //check if there an error with the validate:
    if (error) {
        //extract the error message from the error resp if the data is invalid
        return res.status(406).json({ error: error.details[0].message });
    }

    //check if the user already registered  , 
    const userRegisteredByEmail = await User.findOne({ email: req.body.email });
    const userRegisteredByUsername = await User.findOne({ username: req.body.username });
    if (userRegisteredByEmail) {
        return res.status(400).json({ error: 'user already registered' });
    }
    if (userRegisteredByUsername) {
        return res.status(400).json({ error: 'username unavailable' });
    }

    //crypt the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    //user obj: 
    var user;

    //create the user obj on img founded or not: 
    if (hasProfilePhoto && photoSaved) {
        user = new User({
            fname: req.body.fname,
            lname: req.body.lname,
            username: req.body.username,
            email: req.body.email,
            password: hashedPassword,
            vKey: req.body.vKey,
            admin: req.body.admin,
            photoUrl: fileName
        });
    } else {
        user = new User({
            fname: req.body.fname,
            lname: req.body.lname,
            username: req.body.username,
            email: req.body.email,
            password: hashedPassword,
            vKey: req.body.vKey,
            admin: req.body.admin
        });
    }

    //save the user to the database 
    try {
        const newUser = await user.save();
        var token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
        
        //create the user info card:
        const userInfoCard = new UserInfo({
            fname: user.fname,
            lname: user.lname,
            username: user.username,
            email: user.email,
            photoUrl: user.photoUrl,
            id:user._id,
            admin: user.admin,
            photoUrl: user.photoUrl
        });
        await userInfoCard.save();

        res.status(201).json({ token: token });
    } catch (err) {
        res.status(400).json({ error: 'user cant be registered' });
    }

});

//LOGIN :
router.post('/login', async (req, res) => {

    //validate the inputs 
    const { error } = Joi.validate(req.body, userLoginValidate);
    //check if there an error :
    if (error) {
        //extract the error message from the error resp if the data is invalid
        return res.status(406).json({ error: error.details[0].message });
    }


    //Login vars:
    var usernameOrEmail, password, user, hashedPassword, isLoggedIn;

    password = req.body.password;
    usernameOrEmail = req.body.usernameOrEmail;

    //try to find the user in the database
    user = await User.findOne(
        {
            $or: [
                { username: usernameOrEmail },
                { email: usernameOrEmail }
            ]
        }
    );
    if (!user) {
        return res.status(400).json({ error: 'user can\'t be found.' });
    }
    hashedPassword = user.password;
    isLoggedIn = await bcrypt.compare(password, hashedPassword);
    if (!isLoggedIn) {
        return res.status(400).json({ error: 'incorrect password' })
    }

    // setting up the token for the login
    var token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    //get user card:
    const userCard = await UserInfo.findOne({id: user._id});
    res.status(200).json({ token: token, userCard: userCard });

});

//handel confirm user request http://localhost:3000/users/confirm
router.patch('/confirm', tokenValidate, async (req, res) => {

    //check if the request content validation key
    if (!Number.isInteger(req.body.vKey)) {
        return res.status(400).json({ error: 'valid validation key' });
    }

    const id = req.user.id;
    var user = await User.findOne({ _id: id });
    const verified = user.vKey == req.body.vKey;

    if (verified) {
        try {
            await User.updateOne(
                { _id: id },
                {
                    $set: {
                        verified: 1,
                        updatedAt: Date()
                    }
                }
            );
            user = await User.findOne({ _id: id });
            return res.status(200).json({ verified: user.verified });
        } catch (error) {
            return res.status(400).json(error);
        }
    } else {
        return res.status(400).json({ error: 'valid validation key' });
    }
});

//confirmation info get request:
router.get('/conformation-info', tokenValidate, async (req, res) => {
    const id = req.user.id;
    try {
        var user = await User.findOne({ _id: id });
        res.json({ verified: user.verified, fname: user.fname, email: user.email });
    } catch (error) {
        return res.json({ error: "user cant be found" });
    }

});

//getUserInfoFromId
router.get('/getInfo', async(req, res)=>{
    if (!req.query.id) { return res.status(400).json({ error: 'add the user id in the request' }); }
    try {
        const user = await User.findById(req.query.id).select('_id fname lname username email photoUrl admin');
        return res.status(200).json(user);
    } catch (error) {
        return res.status(400).json({error: error.message});
    }
});

//get user card:
router.get('/getUserCard', tokenValidate, async(req, res)=>{
    try {
        const userInfo = await UserInfo.findOne({id: req.user.id});
        return res.status(200).json(userInfo);
    } catch (error) {
        return res.status(400).json({error: error.message});
    }
});

module.exports = router;
