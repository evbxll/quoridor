#include "headers/game.hpp"
#include "saveGame.cpp"

using std::cout;
using std::endl;
using std::min;
using std::max;


Game::Game(bool user_sim, bool verbose, int rounds, double sim_delay)
        : is_user_sim(user_sim),
        verbose(verbose),
        rounds(rounds),
        sim_delay(sim_delay)
        {
            GameState temp;
            string logString = "";
            game_state_p = std::make_shared<GameState>(temp);
            execution_times.emplace_back(vector<double>{}, vector<double>{});
            hist_per_round.emplace_back(vector<vector<int>>{}, vector<vector<int>>{});
    }

void Game::print_commands() {
    cout << "1. Move your piece by entering mx,y where x is the row number and y column number" << endl;
    cout << "2. Place a wall by entering wa,bd where a is the row letter and b column letter, and where d represents the wall direction and it can be either [v,h]. They represent the vertical or horizontal orientations." << endl;
    cout << '\n' << endl;
}

void Game::Initialize(){
    for (int i = 0; i < SIZE; ++i){
        MoveKeyValues += std::to_string(i);
    }

    for (int i = 0; i < SIZE - 1; ++i) {
        WallKeyValues += static_cast<char>('A' + i);
    }
}

void Game::quick_run(const string& bot1, const string& bot2) {
    cout << '\n' << endl;
    cout << '\n' << endl;
    cout << "### Quick Running rounds ###" << endl;
    player_simulation_algorithms[0] = bot1;
    player_simulation_algorithms[1] = bot2;
    cout << "Chosen algorithm for player 1 is " << bot1 << endl;
    cout << "Chosen algorithm for player 2 is " << bot2 << endl;
    cout << '\n' << endl;
}

void Game::player_user(){
    std::string userInput;
    std::vector<int> userVector;
    while(true) {
        // Prompt the user for input
        std::cout << "Enter three or two digits separated by spaces: ";
        std::getline(std::cin, userInput);

        // Tokenize the input and convert to integers
        std::istringstream iss(userInput);
        int num;
        while (iss >> num) {
            userVector.push_back(num);
        }

        // Check the size of the vector and validate the input
        if (userVector.size() == 2 || userVector.size() == 3) {
            // Print the vector
            std::cout << "User input as a vector: ";
            for (int i = 0; i < userVector.size(); ++i) {
                std::cout << userVector[i] << " ";
            }
            execute_action(userVector);
            return;
        } else {
            std::cout << "Invalid input. Please enter two or three digits." << std::endl;
        }
    }
}

vector<int> Game::randombot_agent(){
    return randombot_action(*game_state_p);
}

vector<int> choose_random_from_actions(const vector<pair<double, vector<int>>>& moves){

    // for (auto p: moves){
    //     cout << p.first << " :    ";
    //     for (auto v: p.second) cout << v << " ";
    //     cout << endl;
    // }

    // Find the highest value (which is the last element in the multimap)
    double highestValue = moves[0].first;

    for (auto p: moves){
        highestValue = max(highestValue, p.first);
    }

    vector<vector<int>> best_moves;
    for (auto p: moves){
        if (p.first == highestValue){
            best_moves.push_back(p.second);
        }
    }

    // for (auto p: best_moves){
    //     for (auto v: p) cout << v << " ";
    //     cout << endl;
    // }

    // Use a random number generator to select a random key from the highestValueKeys
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<int> distribution(0, best_moves.size() - 1);
    int randomIndex = distribution(gen);

    return best_moves[randomIndex];
}

vector<int> Game::minimax_agent(const int depth){
    double alpha = -std::numeric_limits<double>::infinity();
    double beta = std::numeric_limits<double>::infinity();
    double max_val = -std::numeric_limits<double>::infinity();
    vector<pair<double, vector<int>>> best_moves;

    GameState gp = game_state_p->copy();

    int swap = (gp.player1) ? 1 : -1;

    gp.check_wall_blocks_exit_on_gen = false;

    vector<vector<int>> available_moves = gp.get_available_moves();
    for (vector<int> &move : available_moves)
    {

        pair<int, int> temp = gp.get_cur_player_pos();
        vector<int> curpos = {temp.first, temp.second};
        gp.move_piece(move);
        gp.player1 = !gp.player1;

        double reward = swap * minimax_search(gp, depth - 1, alpha, beta, gp.player1);

        gp.player1 = !gp.player1;
        gp.move_piece(curpos);

        if (reward >= max_val)
        {
            max_val = reward;
            best_moves.push_back(std::make_pair(reward, move));
        }
    }

    vector<vector<int>> wall_placements = gp.get_available_wall_placements();

    for (vector<int> &wall : wall_placements)
    {
        int x = wall[0];
        int y = wall[1];
        bool isHorizontal = wall[2];

        gp.set_wall(x, y, isHorizontal);
        gp.player1 = !gp.player1;

        double reward = swap * minimax_search(gp, depth - 1, alpha, beta, gp.player1);
        // cout << reward << " " << wall[0] <<  " " <<  wall[1] <<  " " <<  wall[2] << endl;

        gp.player1 = !gp.player1;
        gp.clear_wall(x, y);
        gp.saved_wall_placements = wall_placements; // reinstate free walls

        if (reward >= max_val)
        {
            max_val = reward;
            best_moves.push_back(std::make_pair(reward, wall));
        }
    }

    gp.check_wall_blocks_exit_on_gen = true;

    return choose_random_from_actions(best_moves);
}

vector<int> Game::pathsearch_agent(){
    double max_val = -std::numeric_limits<double>::infinity();
    vector<pair<double, vector<int>>> best_moves;

    GameState gp = game_state_p->copy();

    int swap = (gp.player1)? 1 : -1;


    vector<vector<int> > available_moves = gp.get_available_moves();
    for (vector<int>& move : available_moves){

        pair<int, int> temp = gp.get_cur_player_pos();
        vector<int> curpos = {temp.first, temp.second};
        gp.move_piece(move);
        gp.player1 = !gp.player1;

        pair<double, double> dists = aStarSearch(gp);

        gp.player1 = !gp.player1;
        gp.move_piece(curpos);

        double reward = swap*(dists.second - dists.first);

        if (reward >= max_val){
            max_val = reward;
            best_moves.push_back(std::make_pair(reward, move));
        }
    }

    vector<vector<int>> wall_placements = gp.get_available_wall_placements();
    for (vector<int>& wall : wall_placements){
        int x = wall[0];
        int y = wall[1];
        bool isHorizontal = wall[2];

        gp.set_wall(x, y, isHorizontal, false);
        gp.player1 = !gp.player1;
        pair<double, double> dists = aStarSearch(gp);
        gp.player1 = !gp.player1;
        gp.clear_wall(x, y);

        double reward = swap*(dists.second - dists.first);

        if (dists.first != std::numeric_limits<double>::infinity() && dists.second != std::numeric_limits<double>::infinity()){
            if (reward >= max_val){
                max_val = reward;
                best_moves.push_back(std::make_pair(reward, wall));
            }
        }
    }
    return choose_random_from_actions(best_moves);
}

void Game::execute_action( vector<int>& action){
    if (action.size() == 2){
        game_state_p->move_piece(action);
    }
    else{
        game_state_p->place_wall(action);
    }
}

vector<int> Game::player_simulation(bool printGame, bool recordMoves) {
    int index = 1 * (!game_state_p->player1);
    int player_number = index + 1;

    vector<int> action;

    std::clock_t t1 = std::clock();

    // if (player_simulation_algorithms[index] == "minimax-alpha-beta-pruning") {
    //     action = minimax_agent(cop, game_state_p->player1);
    // }
    if (player_simulation_algorithms[index] == "path-search") {
        action = pathsearch_agent();
    }
    else if (player_simulation_algorithms[index] == "randomBot") {
        action = randombot_agent();
    }
    else if (player_simulation_algorithms[index] == "minimax") {
        action = minimax_agent();
    }
    // else if (player_simulation_algorithms[index] == "online-bot") {
    //     while (online_move == std::make_pair(0, 0)) {
    //         // Wait for online move
    //     }
    //     action = online_move;
    //     online_move = std::make_pair(0, 0); // Reset online_move
    // }
    else {
        cout << "No bot configured" << std::endl;
    }

    if (!action.empty()) {
        execute_action(action);
        std::clock_t t2 = std::clock();
        if(recordMoves) {
            if (game_state_p->player1){
                execution_times.back().first.push_back(static_cast<double>(t2 - t1) / CLOCKS_PER_SEC);
                hist_per_round.back().first.push_back(action);
            }
            else{
                execution_times.back().second.push_back(static_cast<double>(t2 - t1) / CLOCKS_PER_SEC);
                hist_per_round.back().second.push_back(action);
            }
        }


        if(printGame) {
            if (action.size() == 2) {
                cout << "\r Player " << player_number << " (" << player_simulation_algorithms[index] << ") has moved his piece to " << action[0] << ", " << action[1] << "." << std::endl;
            }
            else {
                string orientation = (action[2]) ? "HORIZONTAL" : "VERTICAL";
                string loc = "(" + string(1, static_cast<char>('a' + action[0])) + ", " + string(1, static_cast<char>('a' + action[1])) + ")";
                cout << "\r Player " << player_number << " (" << player_simulation_algorithms[index] << ") has placed a " << orientation << " wall at " << loc << "." << std::endl;
            }
            cout << "This took " << static_cast<double>(t2 - t1) / CLOCKS_PER_SEC << " seconds." << std::endl;
        }
        logString += vectorToString(action) + " " + std::to_string(static_cast<double>(t2 - t1) / CLOCKS_PER_SEC) + "\n";
        return action;
    }
    else {
        cout << "Player " << player_number << " (" << player_simulation_algorithms[index] << ") has no moves left." << std::endl;
    }
}

void Game::GUI_play(string player1type, string player2type, float *sim_delay, int *rounds, bool *printOut, bool *recordMoves, bool *saveGameLog) {
    player_simulation_algorithms[0] = player1type;
    player_simulation_algorithms[1] = player2type;
    game_state_p->reinitialize();
    string currentTime = getCurrentDate();
    logString = "";
    logString += "size " + std::to_string(SIZE) + "\n";
    logString += "Walls " + std::to_string(WALLS) + "\n";
    logString += "round " + std::to_string(*rounds) + "\n";
    logString += "player1 " + player1type + "\n";
    logString += "player2 " + player2type + "\n";
    while (*rounds > 0) {
        std::clock_t start_time = std::clock();
        game_state_p->get_available_wall_placements();

        if (game_state_p->is_goal_state()) {
            int winner_ind = game_state_p->get_winner();

            if(*recordMoves) {
                vector<double> exec1 = execution_times.back().first;
                vector<double> exec2 = execution_times.back().second;

                double avgtime1 = static_cast<double>(accumulate(exec1.begin(), exec1.end(), 0.0)) / exec1.size();
                double avgtime2 = static_cast<double>(accumulate(exec2.begin(), exec2.end(), 0.0)) / exec2.size();

                int moves1 = hist_per_round.back().first.size();
                int moves2 = moves1 + ((winner_ind == 0)? -1 : 0);

                hist_per_round.emplace_back(vector<vector<int>>{}, vector<vector<int>>{});
                execution_times.emplace_back(vector<double>{}, vector<double>{});

                cout << "Execution averages this round: " <<  avgtime1 << ", " << avgtime2 << endl;
                cout << "Number of moves this round: " <<  moves1 << ", " << moves2 << endl;
            }

            string winner = (winner_ind == 0) ? "P1" : "P2";
            wins[winner_ind]++;
            logString += "Won " + winner;
            if(*saveGameLog) logGame(currentTime, player1type, player2type, logString, *rounds);

            *rounds -= 1;

            logString = "";
            logString += "size " + std::to_string(SIZE) + "\n";
            logString += "Walls " + std::to_string(WALLS) + "\n";
            logString += "round " + std::to_string(*rounds) + "\n";
            logString += "player1 " + player1type + "\n";
            logString += "player2 " + player2type + "\n";



            if (*rounds != 0) {
                game_state_p->reinitialize();
            }
            else{
                cout << "Scores: " << wins[0] << ", " << wins[1] << endl << std::flush;
            }
            continue;
        }

        vector<int> res = player_simulation(*printOut, *recordMoves);
        if (res.size() < 2 || res.size() > 3) {
            cout << "Bot has returned something unholy" << endl;
            exit(1);
        }
        while (static_cast<double>(std::clock() - start_time) / CLOCKS_PER_SEC < *sim_delay) {
            continue;
        }
        game_state_p->player1 = !game_state_p->player1;
    }
}


void Game::print_colored_output(const string& text, const string& color) {
    cout << '\r' << color << text << Color_RESET << endl << std::flush;
}
